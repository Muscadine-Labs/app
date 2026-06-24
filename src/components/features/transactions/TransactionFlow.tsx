'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWaitForTransactionReceipt, useReadContract, useWalletClient, usePublicClient } from 'wagmi';
import { formatUnits, type Address, type PublicClient, type WalletClient } from 'viem';
import { VaultAccount } from '@/types/vault';
import { useTransactionState } from '@/contexts/TransactionContext';
import type { TransactionProgressStep } from '@/types/transactions';
import { isCancellationError, formatTransactionError } from '@/lib/transactionUtils';
import { depositToVaultV2, withdrawFromVaultV2, redeemFromVaultV2 } from '@/lib/transactionUtilsV2';
import { TransactionConfirmation } from './TransactionConfirmation';
import { TransactionStatus as TransactionStatusComponent } from './TransactionStatus';
import { useToast } from '@/contexts/ToastContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
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
    ethGasReserveOnMax,
    setStatus,
  } = useTransactionState();
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

  const shouldClearFlowState = status === 'idle' || status === 'preview';
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
      
      if (isCancellationError(receiptError)) {
        setStatus('preview');
      } else {
        const errorMessage = formatTransactionError(receiptError);
        showErrorToast(errorMessage, 5000);
        setStatus('error', errorMessage);
      }
    }
  }, [receipt, receiptError, status, txHash, effectiveCurrentTxHash, isExecuting, completeSuccessfulTransaction, setStatus, showErrorToast]);

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

    try {
      setIsExecuting(true);
      setCurrentStepIndex(0);
      setStepsInfo([]);
      setTotalSteps(0);
      setCurrentTxHash(null);

      logger.info('Transaction execution started', {
        transactionType,
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
      const depositOptions = { skipEthGasReserve: !ethGasReserveOnMax };

      if (transactionType === 'deposit') {
        const vaultAddr = (toAccount as VaultAccount).address as Address;
        txHash = await depositToVaultV2(
          publicClient as PublicClient,
          walletClient as WalletClient,
          vaultAddr,
          amount,
          assetToUse.decimals,
          preferredAsset,
          onProgress,
          depositOptions
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
      completeSuccessfulTransaction(txHash);

    } catch (err) {
      setIsExecuting(false);
      if (isCancellationError(err)) {
        setStatus('preview');
        setCurrentTxHash(null);
        setStepsInfo([]);
        setTotalSteps(0);
        return;
      }
      
      const errorMessage = formatTransactionError(err);
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
    }
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
  const walletSteps = (isSigning || isApproving || isConfirming || isSuccess) ? (() => {
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
          i === currentStepIndex &&
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
      {(isPreview || isSigning || isApproving || isConfirming || isSuccess) && fromAccount && toAccount && (
        <TransactionConfirmation
          fromAccount={fromAccount}
          toAccount={toAccount}
          amount={amount?.trim() || ''}
          assetSymbol={assetSymbol}
          assetDecimals={derivedAsset?.decimals}
          transactionType={transactionType}
          isLoading={isSigning || isApproving || isConfirming}
          progressSteps={walletSteps}
          showProgress={isSigning || isApproving || isConfirming}
          isSuccess={isSuccess}
          txHash={effectiveCurrentTxHash ?? txHash}
          onCancel={() => {
            if (isSigning || isApproving || isConfirming) {
              // If transaction is in progress, reset to preview
              setStatus('preview');
              setCurrentTxHash(null);
              setStepsInfo([]);
              setTotalSteps(0);
              setCurrentStepIndex(0);
              setIsExecuting(false);
            } else if (isSuccess) {
              // If success, call onSuccess callback to reset
              if (onSuccess) {
                onSuccess();
              }
            } else {
              setStatus('idle');
            }
          }}
          onConfirm={handleConfirm}
        />
      )}

      {/* Error State */}
      {isError && (
        <TransactionStatusComponent
          type="error"
          message={error || 'Transaction failed'}
          onRetry={() => setStatus('preview')}
        />
      )}
    </div>
  );
}

