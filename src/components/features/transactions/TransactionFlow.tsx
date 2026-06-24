'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWaitForTransactionReceipt, useReadContract, useWalletClient, usePublicClient } from 'wagmi';
import { formatUnits, type Address, type PublicClient, type WalletClient } from 'viem';
import { VaultAccount } from '@/types/vault';
import { useTransactionState } from '@/contexts/TransactionContext';
import type { TransactionProgressStep } from '@/types/transactions';
import { isCancellationError, formatTransactionError } from '@/lib/transactionUtils';
import {
  exceedsInstantLiquidity,
  fetchInstantLiquidityAssets,
  getMorphoVaultUrl,
  parseTransactionAmount,
  simulateVaultWithdraw,
} from '@/lib/liquidity-utils';
import { formatAssetAmount } from '@/lib/formatter';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { depositToVaultV2, withdrawFromVaultV2, redeemFromVaultV2, resumeUnwrapWalletWethV2 } from '@/lib/transactionUtilsV2';
import { TransactionConfirmation } from './TransactionConfirmation';
import { WithdrawLiquidityWarningModal } from './WithdrawLiquidityWarningModal';
import { TransactionStatus as TransactionStatusComponent } from './TransactionStatus';
import { useToast } from '@/contexts/ToastContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useVaultVersion } from '@/contexts/VaultVersionContext';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';
import { ERC4626_ABI } from '@/lib/abis';

interface TransactionFlowProps {
  onSuccess?: () => void;
}

function stepTypeForLabel(label: string): 'signing' | 'approving' | 'confirming' {
  const lower = label.toLowerCase();
  if (lower.includes('approve')) return 'approving';
  return 'confirming';
}

function shouldResumeUnwrapOnly(
  transactionType: string | null,
  failedStepIndex: number,
  stepsInfo: Array<{ stepIndex: number; label: string }>
): boolean {
  if (transactionType !== 'withdraw') return false;
  const failedStep = stepsInfo.find((s) => s.stepIndex === failedStepIndex);
  const label = failedStep?.label?.toLowerCase() ?? '';
  if (label.includes('unwrap')) return true;
  return failedStepIndex >= 1;
}

export function TransactionFlow({ onSuccess }: TransactionFlowProps) {
  const {
    fromAccount,
    toAccount,
    amount,
    status,
    error,
    txHash,
    transactionType,
    derivedAsset,
    preferredAsset,
    setStatus,
  } = useTransactionState();
  const { isDevMode } = useVaultVersion();
  const { success, error: showErrorToast } = useToast();
  const { refreshBalancesWithPolling, morphoHoldings, refreshBalances } = useWallet();
  const { fetchVaultData } = useVaultData();
  const router = useRouter();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [currentTxHash, setCurrentTxHash] = useState<string | null>(null);
  const [stepsInfo, setStepsInfo] = useState<Array<{ stepIndex: number; label: string; type: 'signing' | 'approving' | 'confirming'; txHash?: string }>>([]);
  const [totalSteps, setTotalSteps] = useState<number>(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const [liquidityWarningOpen, setLiquidityWarningOpen] = useState(false);
  const [liquidityWarningContext, setLiquidityWarningContext] = useState<{
    morphoVaultUrl: string;
    requestedAmountLabel: string;
    instantLiquidityLabel: string;
  } | null>(null);
  const [isCheckingLiquidity, setIsCheckingLiquidity] = useState(false);
  const currentStepRef = useRef(0);

  const shouldClearFlowState = (status === 'idle' || status === 'preview') && !partialFailure;
  const effectiveCurrentTxHash = shouldClearFlowState ? null : currentTxHash;
  const effectiveStepsInfo = shouldClearFlowState ? [] : stepsInfo;
  const effectiveTotalSteps = shouldClearFlowState ? 0 : totalSteps;

  const { getVaultData } = useVaultData();

  // Get vault position for withdrawals to check if MAX was used
  const vaultPosition = useMemo(() => {
    if (fromAccount?.type !== 'vault' || transactionType !== 'withdraw') return null;
    return morphoHoldings.positions.find(
      (pos) => pos.vault.address.toLowerCase() === (fromAccount as VaultAccount).address.toLowerCase()
    ) || null;
  }, [fromAccount, morphoHoldings.positions, transactionType]);

  const vaultShareBalance = vaultPosition?.shares || null;

  // Use convertToAssets via RPC to get exact asset amount from shares for max withdrawal check
  const { data: exactAssetAmount } = useReadContract({
    address: (transactionType === 'withdraw' && vaultShareBalance && fromAccount?.type === 'vault' 
      ? (fromAccount as VaultAccount).address 
      : undefined) as `0x${string}`,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: vaultShareBalance && fromAccount?.type === 'vault'
      ? [BigInt(vaultShareBalance)]
      : undefined,
    query: {
      enabled: transactionType === 'withdraw' && fromAccount?.type === 'vault' && !!vaultShareBalance && BigInt(vaultShareBalance) > BigInt(0),
    },
  });

  // Check if withdrawal amount matches max (within small tolerance for rounding)
  const shouldUseWithdrawAll = useMemo(() => {
    if (transactionType !== 'withdraw' || !fromAccount || fromAccount.type !== 'vault' || !amount || !exactAssetAmount) {
      return false;
    }

    const vaultAccount = fromAccount as VaultAccount;
    const vaultData = getVaultData(vaultAccount.address);
    if (!vaultData) return false;

    const maxAssetAmount = parseFloat(formatUnits(exactAssetAmount, vaultData.assetDecimals || 18));
    const enteredAmount = parseFloat(amount);

    if (isNaN(enteredAmount) || isNaN(maxAssetAmount) || maxAssetAmount === 0) {
      return false;
    }

    // Check if entered amount is within 0.1% of max (to account for rounding)
    const tolerance = maxAssetAmount * 0.001;
    return Math.abs(enteredAmount - maxAssetAmount) <= tolerance;
  }, [transactionType, fromAccount, amount, exactAssetAmount, getVaultData]);

  const withdrawVaultAddress =
    transactionType === 'withdraw' && fromAccount?.type === 'vault'
      ? (fromAccount as VaultAccount).address
      : null;

  useEffect(() => {
    if (status === 'preview' && withdrawVaultAddress) {
      fetchVaultData(withdrawVaultAddress, BASE_CHAIN_ID, true).catch((err) => {
        logger.error('Failed to refresh vault liquidity for withdraw preview', err, {
          vaultAddress: withdrawVaultAddress,
        });
      });
    }
  }, [status, withdrawVaultAddress, fetchVaultData]);

  const liquidityWarningPreview = useMemo(() => {
    if (status !== 'preview' || !withdrawVaultAddress || !amount?.trim() || !derivedAsset) {
      return null;
    }

    const vaultData = getVaultData(withdrawVaultAddress);
    const instantRaw =
      vaultData?.liquidityBreakdown?.instantLiquidityAssets ?? vaultData?.liquidityAssets;
    if (!instantRaw) return null;

    const decimals = derivedAsset.decimals ?? 18;
    const requested = parseTransactionAmount(amount, decimals);
    const instant = BigInt(instantRaw);

    if (!exceedsInstantLiquidity(requested, instant, decimals)) {
      return null;
    }

    return {
      morphoVaultUrl: getMorphoVaultUrl(BASE_CHAIN_ID, withdrawVaultAddress),
      instantLiquidityLabel: formatAssetAmount(instant, decimals, derivedAsset.symbol),
    };
  }, [status, withdrawVaultAddress, amount, derivedAsset, getVaultData]);

  // Wait for main transaction receipt (fallback only — v2 flow confirms inside depositToVaultV2)
  const txHashToWaitFor = effectiveCurrentTxHash || txHash;
  const { data: receipt, error: receiptError } = useWaitForTransactionReceipt({
    hash: txHashToWaitFor as `0x${string}`,
    query: {
      enabled: !!txHashToWaitFor && status === 'confirming' && !isExecuting,
    },
  });

  const completeSuccessfulTransaction = useCallback(
    (hashToUse: string) => {
      success('Transaction confirmed!', 3000);
      setStatus('success', undefined, hashToUse);

      const refreshData = async () => {
        try {
          await refreshBalances();

          const vaultsInTransaction = new Set<string>();
          if (fromAccount?.type === 'vault') {
            vaultsInTransaction.add((fromAccount as VaultAccount).address);
          }
          if (toAccount?.type === 'vault') {
            vaultsInTransaction.add((toAccount as VaultAccount).address);
          }

          await Promise.allSettled(
            Array.from(vaultsInTransaction).map((vaultAddress) =>
              fetchVaultData(vaultAddress, 8453, true).catch((err) => {
                logger.error('Failed to refresh vault data', err, { vaultAddress, txHash: hashToUse });
              })
            )
          );

          const vaultsToRefresh = morphoHoldings.positions.map((pos) => pos.vault.address);
          await Promise.allSettled(
            vaultsToRefresh.map((vaultAddress) =>
              fetchVaultData(vaultAddress, 8453, true).catch((err) => {
                logger.error('Failed to refresh vault data', err, { vaultAddress, txHash: hashToUse });
              })
            )
          );

          router.refresh();

          logger.info('Data refreshed successfully after transaction', {
            txHash: hashToUse,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error('Error refreshing data after transaction', error, { txHash: hashToUse });
        }
      };

      refreshData();

      refreshBalancesWithPolling({
        followUpDelayMs: 8000,
        onComplete: async () => {
          logger.info('Wallet balances refreshed successfully after transaction', {
            txHash: hashToUse,
            timestamp: new Date().toISOString(),
          });
        },
      }).catch((err: unknown) => {
        logger.error('Failed to refresh wallet balances after polling', err, { txHash: hashToUse });
      });
    },
    [
      success,
      setStatus,
      refreshBalances,
      fromAccount,
      toAccount,
      fetchVaultData,
      morphoHoldings.positions,
      router,
      refreshBalancesWithPolling,
    ]
  );

  // Handle transaction receipt (fallback path when not using in-flow completion)
  useEffect(() => {
    const hashToUse = effectiveCurrentTxHash || txHash;

    if (receipt) {
      logger.info('Transaction receipt received', {
        txHash: hashToUse,
        blockNumber: receipt.blockNumber?.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed?.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
        transactionStatus: status,
      });
    }

    if (
      receipt &&
      status === 'confirming' &&
      hashToUse &&
      !isExecuting
    ) {
      logger.info('Transaction confirmed on-chain', {
        txHash: hashToUse,
        blockNumber: receipt.blockNumber?.toString(),
        status: receipt.status,
        timestamp: new Date().toISOString(),
      });
      completeSuccessfulTransaction(hashToUse);
    } else if (receiptError && status === 'confirming' && hashToUse && !isExecuting) {
      logger.error('Transaction receipt error', receiptError, {
        txHash: hashToUse,
        isCancellation: isCancellationError(receiptError),
      });

      const failedPastFirstStep = currentStepRef.current > 0;

      if (isCancellationError(receiptError)) {
        if (failedPastFirstStep) {
          setPartialFailure(true);
          setStatus('error', 'Transaction cancelled');
        } else {
          setStatus('preview');
        }
      } else {
        const errorMessage = formatTransactionError(receiptError);
        if (failedPastFirstStep) {
          setPartialFailure(true);
          setStatus('error', errorMessage);
        } else {
          showErrorToast(errorMessage, 5000);
          setStatus('error', errorMessage);
        }
      }
    }
  }, [receipt, receiptError, status, txHash, effectiveCurrentTxHash, isExecuting, completeSuccessfulTransaction, setStatus, showErrorToast]);

  const executeTransaction = useCallback(async () => {
    if (!fromAccount || !toAccount || !amount || !transactionType) return;

    const assetToUse = derivedAsset || (fromAccount.type === 'vault' 
      ? { symbol: (fromAccount as VaultAccount).symbol, decimals: (fromAccount as VaultAccount).assetDecimals ?? 18 }
      : toAccount.type === 'vault'
      ? { symbol: (toAccount as VaultAccount).symbol, decimals: (toAccount as VaultAccount).assetDecimals ?? 18 }
      : null);

    if (!assetToUse) {
      const errorMessage = 'Unable to determine asset type. Please try again.';
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
      return;
    }

    if (!walletClient || !publicClient) {
      const errorMessage = 'Wallet not connected. Please connect your wallet and try again.';
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
      return;
    }

    try {
      setLiquidityWarningOpen(false);
      setLiquidityWarningContext(null);
      setIsExecuting(true);
      const isResuming = partialFailure;

      if (!isResuming) {
        setCurrentStepIndex(0);
        currentStepRef.current = 0;
        setStepsInfo([]);
        setTotalSteps(0);
        setCurrentTxHash(null);
        setPartialFailure(false);
      }

      logger.info('Transaction execution started', {
        transactionType,
        isResuming,
        resumeStep: isResuming ? currentStepRef.current : 0,
        fromAccount: fromAccount?.type === 'wallet' ? 'wallet' : (fromAccount as VaultAccount)?.address,
        toAccount: toAccount?.type === 'wallet' ? 'wallet' : (toAccount as VaultAccount)?.address,
        amount,
        assetSymbol: assetToUse.symbol,
        timestamp: new Date().toISOString(),
      });
      
      const onProgress = (step: TransactionProgressStep) => {
        if (step.type === 'planned') {
          setTotalSteps(step.totalSteps);
          setStepsInfo(
            step.stepLabels.map((label, stepIndex) => ({
              stepIndex,
              label,
              type: stepTypeForLabel(label),
            }))
          );
          return;
        }

        if (step.type === 'confirming' && step.txHash) {
          logger.info('Transaction step sent, awaiting confirmation', {
            txHash: step.txHash,
            stepIndex: step.stepIndex,
            stepLabel: step.stepLabel,
            timestamp: new Date().toISOString(),
          });
        }
        setTotalSteps(step.totalSteps);
        setCurrentStepIndex(step.stepIndex);
        currentStepRef.current = step.stepIndex;
        
        setStepsInfo(prev => {
          const newSteps = [...prev];
          const existingIndex = newSteps.findIndex(s => s.stepIndex === step.stepIndex);
          const stepInfo = {
            stepIndex: step.stepIndex,
            label:
              step.stepLabel ||
              (step.type === 'signing'
                ? 'Pre authorize'
                : step.type === 'approving'
                  ? 'Approve token'
                  : 'Confirm'),
            type: step.type,
            txHash: step.type === 'confirming' ? step.txHash : (step.type === 'approving' && 'txHash' in step ? step.txHash : undefined)
          };
          
          if (existingIndex >= 0) {
            newSteps[existingIndex] = stepInfo;
          } else {
            while (newSteps.length <= step.stepIndex) {
              newSteps.push({ stepIndex: newSteps.length, label: '', type: 'confirming' });
            }
            newSteps[step.stepIndex] = stepInfo;
          }
          
          return newSteps;
        });
        
        if (step.type === 'signing') {
          setStatus('signing');
        } else if (step.type === 'approving') {
          setStatus('approving');
        } else if (step.type === 'confirming') {
          setStatus('confirming');
        }
      };

      let txHash: string;

      const resumeStepIndex = currentStepRef.current;
      const resumeTotalSteps = totalSteps > 0 ? totalSteps : Math.max(stepsInfo.length, 2);

      if (
        isResuming &&
        shouldResumeUnwrapOnly(transactionType, resumeStepIndex, stepsInfo)
      ) {
        const priorWithdrawHash = stepsInfo.find((s) => s.stepIndex === 0 && s.txHash)?.txHash;
        if (!priorWithdrawHash) {
          throw new Error(
            'Previous withdrawal transaction not found.\n\n' +
              'Use Start over if you need to withdraw again.'
          );
        }
        txHash = await resumeUnwrapWalletWethV2(
          publicClient as PublicClient,
          walletClient as WalletClient,
          priorWithdrawHash as `0x${string}`,
          onProgress,
          resumeStepIndex,
          resumeTotalSteps
        );
      } else if (transactionType === 'deposit') {
        const vaultAddr = (toAccount as VaultAccount).address as Address;
        txHash = await depositToVaultV2(
          publicClient as PublicClient,
          walletClient as WalletClient,
          vaultAddr,
          amount,
          assetToUse.decimals,
          preferredAsset,
          onProgress,
          { skipEthGasReserve: isDevMode }
        );
      } else if (transactionType === 'withdraw') {
        const vaultAddr = (fromAccount as VaultAccount).address as Address;
        const withdrawPreferredAsset =
          preferredAsset === 'ALL' ? undefined : (preferredAsset as 'ETH' | 'WETH' | undefined);
        if (shouldUseWithdrawAll) {
          txHash = await redeemFromVaultV2(
            publicClient as PublicClient,
            walletClient as WalletClient,
            vaultAddr,
            assetToUse.decimals,
            withdrawPreferredAsset,
            onProgress
          );
        } else {
          txHash = await withdrawFromVaultV2(
            publicClient as PublicClient,
            walletClient as WalletClient,
            vaultAddr,
            amount,
            assetToUse.decimals,
            withdrawPreferredAsset,
            onProgress
          );
        }
      } else if (transactionType === 'transfer') {
        throw new Error('Vault-to-vault transfers are not supported');
      } else {
        throw new Error('Invalid transaction type');
      }

      setIsExecuting(false);
      setCurrentTxHash(txHash);
      setPartialFailure(false);
      completeSuccessfulTransaction(txHash);

    } catch (err) {
      setIsExecuting(false);
      if (isCancellationError(err)) {
        if (partialFailure || currentStepRef.current > 0) {
          setPartialFailure(true);
          setStatus('error', 'Transaction cancelled');
        } else {
          setStatus('preview');
          setCurrentTxHash(null);
          setStepsInfo([]);
          setTotalSteps(0);
          setPartialFailure(false);
        }
        return;
      }
      
      const errorMessage = formatTransactionError(err);
      const failedPastFirstStep = currentStepRef.current > 0;
      if (failedPastFirstStep) {
        setPartialFailure(true);
      }
      setStatus('error', errorMessage);
      if (!failedPastFirstStep) {
        showErrorToast(errorMessage, 5000);
      }
    }
  }, [
    fromAccount,
    toAccount,
    amount,
    transactionType,
    derivedAsset,
    walletClient,
    publicClient,
    partialFailure,
    stepsInfo,
    totalSteps,
    preferredAsset,
    isDevMode,
    shouldUseWithdrawAll,
    completeSuccessfulTransaction,
    setStatus,
    showErrorToast,
  ]);

  const handleConfirm = async () => {
    if (!fromAccount || !toAccount || !amount || !transactionType) return;

    const assetToUse = derivedAsset || (fromAccount.type === 'vault' 
      ? { symbol: (fromAccount as VaultAccount).symbol, decimals: (fromAccount as VaultAccount).assetDecimals ?? 18 }
      : toAccount.type === 'vault'
      ? { symbol: (toAccount as VaultAccount).symbol, decimals: (toAccount as VaultAccount).assetDecimals ?? 18 }
      : null);

    if (!assetToUse) {
      const errorMessage = 'Unable to determine asset type. Please try again.';
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
      return;
    }

    if (!walletClient || !publicClient) {
      const errorMessage = 'Wallet not connected. Please connect your wallet and try again.';
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
      return;
    }

    if (!partialFailure && transactionType === 'withdraw' && fromAccount.type === 'vault') {
      const vaultAccount = fromAccount as VaultAccount;
      setIsCheckingLiquidity(true);
      try {
        const requested = parseTransactionAmount(amount, assetToUse.decimals);
        const instant =
          (await fetchInstantLiquidityAssets(vaultAccount.address, BASE_CHAIN_ID)) ??
          (() => {
            const cached = getVaultData(vaultAccount.address);
            const raw =
              cached?.liquidityBreakdown?.instantLiquidityAssets ?? cached?.liquidityAssets;
            return raw ? BigInt(raw) : null;
          })();

        await fetchVaultData(vaultAccount.address, BASE_CHAIN_ID, true);

        if (instant !== null && exceedsInstantLiquidity(requested, instant, assetToUse.decimals)) {
          const simulationSucceeded = await simulateVaultWithdraw(
            publicClient as PublicClient,
            walletClient as WalletClient,
            vaultAccount.address as Address,
            requested,
            shouldUseWithdrawAll
          );

          if (!simulationSucceeded) {
            setLiquidityWarningContext({
              morphoVaultUrl: getMorphoVaultUrl(BASE_CHAIN_ID, vaultAccount.address),
              requestedAmountLabel: formatAssetAmount(
                requested,
                assetToUse.decimals,
                assetToUse.symbol
              ),
              instantLiquidityLabel: formatAssetAmount(
                instant,
                assetToUse.decimals,
                assetToUse.symbol
              ),
            });
            setLiquidityWarningOpen(true);
            return;
          }
        }
      } finally {
        setIsCheckingLiquidity(false);
      }
    }

    await executeTransaction();
  };

  const handleLiquidityWarningContinue = async () => {
    setLiquidityWarningOpen(false);
    setLiquidityWarningContext(null);
    await executeTransaction();
  };

  const isSigning = status === 'signing';
  const isApproving = status === 'approving';
  const isConfirming = status === 'confirming';
  const isSuccess = status === 'success';
  const isError = status === 'error';
  const isPreview = status === 'preview';

  if (!isPreview && (!fromAccount || !toAccount || !derivedAsset)) {
    return null;
  }

  if (isPreview && (!fromAccount || !toAccount)) {
    return null;
  }

  // Calculate steps for wallet progress bar (shown in confirmation modal)
  // Since executeVaultAction waits for prerequisite receipts internally, we determine
  // step completion based on status progression rather than individual receipt tracking
  const walletSteps = (isSigning || isApproving || isConfirming || isSuccess || (isError && partialFailure)) ? (() => {
    const resolvedStepCount = effectiveTotalSteps > 0 ? effectiveTotalSteps : (effectiveStepsInfo.length > 0 ? Math.max(...effectiveStepsInfo.map(s => s.stepIndex)) + 1 : 0);
    
    if (resolvedStepCount > 0) {
      return Array.from({ length: resolvedStepCount }, (_, i) => {
        const stepInfo = effectiveStepsInfo.find(s => s.stepIndex === i);
        
        // Determine if step is completed:
        // - Confirming steps: completed if we have a receipt
        // - Signing/approving steps: completed if status has progressed past them
        //   (i.e., if we're in confirming/success, all previous steps are done)
        const isCompleted = i < currentStepIndex || isSuccess;
        
        const isActive =
          isError && partialFailure
            ? i === currentStepIndex
            : i === currentStepIndex &&
              !isSuccess &&
              (isSigning || isApproving || isConfirming);
        
        const label = stepInfo?.label || 'Confirm';
        
        return {
          label,
          completed: isCompleted || (isSuccess && i < resolvedStepCount),
          active: isActive
        };
      });
    }
    
    if (isSuccess) {
      return [{ label: 'Confirm', completed: true, active: false }];
    }
    
    return [
      { label: 'Pre authorize', completed: false, active: isApproving || isSigning },
      { label: 'Confirm', completed: false, active: isConfirming }
    ];
  })() : [];

  const assetSymbol = derivedAsset?.symbol || (fromAccount?.type === 'vault' 
    ? (fromAccount as VaultAccount).symbol 
    : toAccount?.type === 'vault' 
    ? (toAccount as VaultAccount).symbol 
    : '');

  return (
    <div className="space-y-6">
      {/* Progress bar is now shown at the page level */}

      {/* Transaction Confirmation - Show during preview, transaction flow, and success */}
      {(isPreview || isSigning || isApproving || isConfirming || isSuccess || (isError && partialFailure)) && fromAccount && toAccount && (
        <TransactionConfirmation
          fromAccount={fromAccount}
          toAccount={toAccount}
          amount={amount?.trim() || ''}
          assetSymbol={assetSymbol}
          assetDecimals={derivedAsset?.decimals}
          transactionType={transactionType}
          isLoading={isSigning || isApproving || isConfirming || isCheckingLiquidity}
          liquidityWarningPreview={liquidityWarningPreview}
          progressSteps={walletSteps}
          showProgress={isSigning || isApproving || isConfirming || (isError && partialFailure)}
          isSuccess={isSuccess}
          isPartialFailure={isError && partialFailure}
          errorMessage={isError && partialFailure ? error ?? undefined : undefined}
          txHash={effectiveCurrentTxHash ?? txHash}
          onCancel={() => {
            if (isSigning || isApproving || isConfirming) {
              setStatus('preview');
              setCurrentTxHash(null);
              setStepsInfo([]);
              setTotalSteps(0);
              setCurrentStepIndex(0);
              currentStepRef.current = 0;
              setIsExecuting(false);
              setPartialFailure(false);
            } else if (isSuccess) {
              if (onSuccess) {
                onSuccess();
              }
            } else if (isError && partialFailure) {
              setStatus('preview');
              setPartialFailure(false);
              setCurrentTxHash(null);
              setStepsInfo([]);
              setTotalSteps(0);
              setCurrentStepIndex(0);
              currentStepRef.current = 0;
            } else {
              setStatus('idle');
            }
          }}
          onConfirm={handleConfirm}
        />
      )}

      {/* Error State — full restart only when the first step failed */}
      {isError && !partialFailure && (
        <TransactionStatusComponent
          type="error"
          message={error || 'Transaction failed'}
          onRetry={() => setStatus('preview')}
        />
      )}
      {liquidityWarningContext && (
        <WithdrawLiquidityWarningModal
          isOpen={liquidityWarningOpen}
          onClose={() => setLiquidityWarningOpen(false)}
          onContinue={handleLiquidityWarningContinue}
          morphoVaultUrl={liquidityWarningContext.morphoVaultUrl}
          requestedAmountLabel={liquidityWarningContext.requestedAmountLabel}
          instantLiquidityLabel={liquidityWarningContext.instantLiquidityLabel}
        />
      )}
    </div>
  );
}

