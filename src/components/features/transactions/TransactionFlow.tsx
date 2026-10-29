'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAccount, useConfig, useSwitchChain, useWaitForTransactionReceipt, useReadContract, useWalletClient, usePublicClient } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { parseUnits, type Address, type PublicClient, type WalletClient } from 'viem';
import { VaultAccount } from '@/types/vault';
import { useTransactionState } from '@/contexts/TransactionContext';
import type { TransactionProgressStep } from '@/types/transactions';
import { isCancellationError, formatTransactionError } from '@/lib/transactionUtils';
import {
  getMorphoVaultUrl,
  parseTransactionAmount,
  simulateVaultWithdraw,
} from '@/lib/liquidity-utils';
import {
  formatForcePenaltyAmount,
  formatPenaltyRatePercent,
  ForceWithdrawShortfallError,
  planForceWithdrawV2,
  readInstantLiquidityAssets,
  simulateForceWithdrawPlan,
  type ForceWithdrawPlan,
} from '@/lib/force-withdraw-v2';
import { formatAssetAmount, formatBigIntForInput } from '@/lib/formatter';
import { BASE_CHAIN_ID, POST_TX_BALANCE_REFRESH_DELAY_MS } from '@/lib/constants';
import {
  depositToVaultV2,
  withdrawFromVaultV2,
  redeemFromVaultV2,
  forceWithdrawFromVaultV2,
} from '@/lib/transactionUtilsV2';
import { TransactionConfirmation } from './TransactionConfirmation';
import { WithdrawLiquidityWarningModal } from './WithdrawLiquidityWarningModal';
import { TransactionStatus as TransactionStatusComponent } from './TransactionStatus';
import { useToast } from '@/contexts/ToastContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { logger } from '@/lib/logger';
import { VAULT_DEPOSIT_GATES_QUERY_KEY, VaultDepositBlockedError } from '@/lib/vault-gates';
import { DEPOSIT_CAPACITY_QUERY_KEY, DepositCapExceededError } from '@/lib/deposit-capacity';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ERC20_BALANCE_ABI, ERC4626_ABI } from '@/lib/abis';

interface TransactionFlowProps {
  onSuccess?: () => void;
  /** When set, success "Done" stays in context (e.g. closes vault modal). */
  onSuccessComplete?: () => void;
  /** When set, preview cancel returns to amount step instead of leaving flow idle globally. */
  onReturnToIdle?: () => void;
  /** Softer layout for vault transact modal. */
  embedded?: boolean;
}

function stepTypeForLabel(label: string): 'signing' | 'approving' | 'confirming' {
  const lower = label.toLowerCase();
  if (lower.includes('approve')) return 'approving';
  return 'confirming';
}

export function TransactionFlow({
  onSuccess,
  onSuccessComplete,
  onReturnToIdle,
  embedded = false,
}: TransactionFlowProps) {
  const {
    fromAccount,
    toAccount,
    amount,
    status,
    error,
    txHash,
    transactionType,
    derivedAsset,
    setAmount,
    setStatus,
  } = useTransactionState();
  const { success, error: showErrorToast } = useToast();
  const { refreshBalancesWithPolling, morphoHoldings, refreshBalances } = useWallet();
  const { fetchVaultData } = useVaultData();
  const router = useRouter();
  const { data: walletClient } = useWalletClient();
  const wagmiConfig = useConfig();
  const { chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  /**
   * Wallet client on Base for sending. If the wallet is on another network, ask it to switch
   * first (viem would otherwise refuse with an unclear error), then take a fresh client: the
   * one from the hook still points at the old chain until the next render.
   */
  const resolveBaseWalletClient = useCallback(async (): Promise<WalletClient> => {
    if (walletChainId === BASE_CHAIN_ID && walletClient?.chain?.id === BASE_CHAIN_ID) {
      return walletClient as WalletClient;
    }
    try {
      await switchChainAsync({ chainId: BASE_CHAIN_ID });
    } catch (err) {
      if (isCancellationError(err)) throw err;
      throw new Error('Switch your wallet to the Base network to continue.');
    }
    return (await getWalletClient(wagmiConfig, { chainId: BASE_CHAIN_ID })) as WalletClient;
  }, [walletChainId, walletClient, switchChainAsync, wagmiConfig]);
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const [currentTxHash, setCurrentTxHash] = useState<string | null>(null);
  const [stepsInfo, setStepsInfo] = useState<Array<{ stepIndex: number; label: string; type: 'signing' | 'approving' | 'confirming'; txHash?: string }>>([]);
  const [totalSteps, setTotalSteps] = useState<number>(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const [liquidityWarningOpen, setLiquidityWarningOpen] = useState(false);
  const [liquidityWarningContext, setLiquidityWarningContext] = useState<{
    morphoVaultUrl: string | null;
    requestedAmountLabel: string;
    instantLiquidityLabel: string;
    estimatedPenaltyLabel: string | null;
    penaltyRateLabel: string | null;
    expectedOutLabel: string | null;
    forceWithdrawAvailable: boolean;
    mayLeaveShareDust: boolean;
  } | null>(null);
  const [isCheckingLiquidity, setIsCheckingLiquidity] = useState(false);
  const currentStepRef = useRef(0);
  const forcePlanRef = useRef<ForceWithdrawPlan | null>(null);
  const executingRef = useRef(false);
  const confirmLockRef = useRef(false);

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

  // Share balance read on chain for the MAX (redeem) check; wallet state only while it loads.
  const { address: connectedAddress } = useAccount();
  const withdrawVaultAddress =
    transactionType === 'withdraw' && fromAccount?.type === 'vault'
      ? ((fromAccount as VaultAccount).address as `0x${string}`)
      : undefined;
  const { data: onChainShares } = useReadContract({
    address: withdrawVaultAddress && connectedAddress ? withdrawVaultAddress : undefined,
    chainId: BASE_CHAIN_ID,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: !!withdrawVaultAddress && !!connectedAddress },
  });
  const vaultShareBalance =
    onChainShares !== undefined ? onChainShares.toString() : vaultPosition?.shares || null;
  const vaultShareBalanceBn = useMemo((): bigint | null => {
    if (!vaultShareBalance) return null;
    try {
      return BigInt(vaultShareBalance);
    } catch {
      return null;
    }
  }, [vaultShareBalance]);

  // Use convertToAssets via RPC to get exact asset amount from shares for max withdrawal check
  const { data: exactAssetAmount } = useReadContract({
    address: (transactionType === 'withdraw' && vaultShareBalanceBn !== null && fromAccount?.type === 'vault' 
      ? (fromAccount as VaultAccount).address 
      : undefined) as `0x${string}`,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: vaultShareBalanceBn !== null && fromAccount?.type === 'vault'
      ? [vaultShareBalanceBn]
      : undefined,
    query: {
      enabled:
        transactionType === 'withdraw' &&
        fromAccount?.type === 'vault' &&
        vaultShareBalanceBn !== null &&
        vaultShareBalanceBn > BigInt(0),
    },
  });

  // Treat as full exit only when amount is essentially MAX (bigint compare — not float).
  const shouldUseWithdrawAll = useMemo(() => {
    if (transactionType !== 'withdraw' || !fromAccount || fromAccount.type !== 'vault' || !amount || !exactAssetAmount) {
      return false;
    }

    const vaultAccount = fromAccount as VaultAccount;
    const decimals =
      vaultAccount.assetDecimals ??
      getVaultData(vaultAccount.address)?.assetDecimals ??
      18;

    let entered: bigint;
    try {
      entered = parseUnits(amount, decimals);
    } catch {
      return false;
    }

    const max = exactAssetAmount;
    if (max === BigInt(0)) return false;

    const diff = entered > max ? entered - max : max - entered;
    // ~1 unit at ≤8 display decimals, or 0.001% of max — whichever is larger.
    const absTol =
      decimals > 8 ? BigInt(10) ** BigInt(decimals - 8) : BigInt(1);
    const relTol = max / BigInt(100_000);
    const tol = absTol > relTol ? absTol : relTol;
    return diff <= tol;
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
              fetchVaultData(vaultAddress, BASE_CHAIN_ID, true).catch((err) => {
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
        followUpDelayMs: POST_TX_BALANCE_REFRESH_DELAY_MS,
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
    if (executingRef.current) return;
    executingRef.current = true;

    const assetToUse = derivedAsset || (fromAccount.type === 'vault' 
      ? { symbol: (fromAccount as VaultAccount).symbol, decimals: (fromAccount as VaultAccount).assetDecimals ?? 18 }
      : toAccount.type === 'vault'
      ? { symbol: (toAccount as VaultAccount).symbol, decimals: (toAccount as VaultAccount).assetDecimals ?? 18 }
      : null);

    if (!assetToUse) {
      executingRef.current = false;
      const errorMessage = 'Unable to determine asset type. Please try again.';
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
      return;
    }

    if (!walletClient || !publicClient) {
      executingRef.current = false;
      const errorMessage = 'Wallet not connected. Please connect your wallet and try again.';
      setStatus('error', errorMessage);
      showErrorToast(errorMessage, 5000);
      return;
    }

    try {
      setLiquidityWarningOpen(false);
      setLiquidityWarningContext(null);
      setIsExecuting(true);
      const baseWalletClient = await resolveBaseWalletClient();
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

      if (transactionType === 'deposit') {
        const vaultAddr = (toAccount as VaultAccount).address as Address;
        txHash = await depositToVaultV2(
          publicClient as PublicClient,
          baseWalletClient,
          vaultAddr,
          amount,
          assetToUse.decimals,
          onProgress
        );
      } else if (transactionType === 'withdraw') {
        const vaultAddr = (fromAccount as VaultAccount).address as Address;

        const forcePlan = forcePlanRef.current;
        if (forcePlan) {
          txHash = await forceWithdrawFromVaultV2(
            publicClient as PublicClient,
            baseWalletClient,
            forcePlan,
            onProgress
          );
          forcePlanRef.current = null;
        } else if (shouldUseWithdrawAll) {
          txHash = await redeemFromVaultV2(
            publicClient as PublicClient,
            baseWalletClient,
            vaultAddr,
            onProgress
          );
        } else {
          txHash = await withdrawFromVaultV2(
            publicClient as PublicClient,
            baseWalletClient,
            vaultAddr,
            amount,
            assetToUse.decimals,
            onProgress
          );
        }
      } else {
        throw new Error('Invalid transaction type');
      }

      setCurrentTxHash(txHash);
      setPartialFailure(false);
      completeSuccessfulTransaction(txHash);
      executingRef.current = false;
      setIsExecuting(false);

    } catch (err) {
      executingRef.current = false;
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
      
      if (err instanceof VaultDepositBlockedError) {
        void queryClient.invalidateQueries({ queryKey: VAULT_DEPOSIT_GATES_QUERY_KEY });
      }

      if (err instanceof DepositCapExceededError) {
        void queryClient.invalidateQueries({ queryKey: DEPOSIT_CAPACITY_QUERY_KEY });
        let errorMessage = err.message;
        if (err.maxAssets > BigInt(0)) {
          setAmount(formatBigIntForInput(err.maxAssets, assetToUse.decimals));
          const capped = formatAssetAmount(err.maxAssets, assetToUse.decimals, assetToUse.symbol);
          errorMessage = `That amount is above this vault's deposit caps. The amount was lowered to ${capped}, the most it can accept right now.`;
        }
        setStatus('error', errorMessage);
        showErrorToast(errorMessage, 5000);
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
    queryClient,
    partialFailure,
    shouldUseWithdrawAll,
    resolveBaseWalletClient,
    completeSuccessfulTransaction,
    setAmount,
    setStatus,
    showErrorToast,
  ]);

  const handleConfirm = async () => {
    if (!fromAccount || !toAccount || !amount || !transactionType) return;
    if (executingRef.current || isExecuting || isCheckingLiquidity || confirmLockRef.current) {
      return;
    }
    confirmLockRef.current = true;
    try {
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
          fetchVaultData(vaultAccount.address, BASE_CHAIN_ID, true).catch((err) => {
            logger.warn('Vault data refresh failed before withdraw', {
              vaultAddress: vaultAccount.address,
              error: err instanceof Error ? err.message : String(err),
            });
          });

          // Always simulate the plain exit. Cached instant liquidity (API / CDN) can be stale,
          // so it cannot decide on its own whether a plain withdraw will go through.
          const simulationSucceeded = await simulateVaultWithdraw(
            publicClient as PublicClient,
            walletClient as WalletClient,
            vaultAccount.address as Address,
            requested,
            shouldUseWithdrawAll
          );

          if (!simulationSucceeded) {
            const userAddress = walletClient.account?.address as Address | undefined;
            let forcePlan: ForceWithdrawPlan | null = null;
            let forceOk = false;
            // Planner read fresh on-chain liquidity and found it covers the request, so the plain
            // exit failed for another reason. Send it and let the wallet surface the real error.
            let instantCoversRequest = false;
            // Planner failed for a reason other than a shortfall (usually RPC).
            let planFailed = false;

            if (userAddress) {
              try {
                forcePlan = await planForceWithdrawV2(
                  publicClient as PublicClient,
                  vaultAccount.address as Address,
                  requested,
                  userAddress,
                  { useRedeemExit: shouldUseWithdrawAll }
                );
                instantCoversRequest = forcePlan === null;
                if (forcePlan) {
                  forceOk = await simulateForceWithdrawPlan(
                    publicClient as PublicClient,
                    forcePlan,
                    userAddress
                  );
                  if (!forceOk) forcePlan = null;
                }
              } catch (planErr) {
                if (planErr instanceof ForceWithdrawShortfallError) {
                  setAmount(formatBigIntForInput(planErr.reachableAssets, assetToUse.decimals));
                  const capped = formatAssetAmount(
                    planErr.reachableAssets,
                    assetToUse.decimals,
                    assetToUse.symbol
                  );
                  const errorMessage = `That amount is above available liquidity. The maximum is ${capped}.`;
                  setStatus('error', errorMessage);
                  showErrorToast(errorMessage, 5000);
                  return;
                }
                logger.warn('Force withdraw planning failed', {
                  vaultAddress: vaultAccount.address,
                  error: planErr instanceof Error ? planErr.message : String(planErr),
                });
                forcePlan = null;
                forceOk = false;
                planFailed = true;
              }
            }

            if (!instantCoversRequest) {
              forcePlanRef.current = forceOk && forcePlan ? forcePlan : null;

              // On-chain only: what the vault can pay right now.
              const instant =
                forcePlan?.instantLiquidityAssets ??
                (await readInstantLiquidityAssets(
                  publicClient as PublicClient,
                  vaultAccount.address as `0x${string}`
                ));

              // Neither the planner nor the liquidity read got an answer: this is a network
              // problem, not low liquidity, so say that instead of showing the warning.
              if (planFailed && instant === null) {
                const errorMessage =
                  "Couldn't check this vault's liquidity right now (network error). Please try again.";
                setStatus('error', errorMessage);
                showErrorToast(errorMessage, 5000);
                return;
              }

              setLiquidityWarningContext({
                morphoVaultUrl: getMorphoVaultUrl(BASE_CHAIN_ID, vaultAccount.address),
                requestedAmountLabel: formatAssetAmount(
                  requested,
                  assetToUse.decimals,
                  assetToUse.symbol
                ),
                instantLiquidityLabel:
                  instant !== null
                    ? formatAssetAmount(instant, assetToUse.decimals, assetToUse.symbol)
                    : 'part of that amount',
                estimatedPenaltyLabel: forcePlan
                  ? formatForcePenaltyAmount(
                      forcePlan.estimatedPenaltyAssets,
                      assetToUse.decimals,
                      assetToUse.symbol
                    )
                  : null,
                penaltyRateLabel: forcePlan
                  ? formatPenaltyRatePercent(forcePlan.maxPenaltyWad)
                  : null,
                expectedOutLabel: forcePlan
                  ? formatAssetAmount(
                      forcePlan.expectedAssetsOut,
                      assetToUse.decimals,
                      assetToUse.symbol
                    )
                  : null,
                forceWithdrawAvailable: Boolean(forceOk && forcePlan),
                mayLeaveShareDust:
                  shouldUseWithdrawAll && Boolean(forcePlan && forcePlan.exitMode === 'withdraw'),
              });
              setLiquidityWarningOpen(true);
              return;
            }
          }
        } catch (err) {
          logger.error('Liquidity pre-check failed; continuing without warning gate', err, {
            vaultAddress: vaultAccount.address,
          });
        } finally {
          setIsCheckingLiquidity(false);
        }
      }

      await executeTransaction();
    } finally {
      confirmLockRef.current = false;
    }
  };

  const handleLiquidityWarningForceWithdraw = async () => {
    if (!forcePlanRef.current) return;
    setLiquidityWarningOpen(false);
    setLiquidityWarningContext(null);
    await executeTransaction();
  };

  const handleLiquidityWarningClose = () => {
    forcePlanRef.current = null;
    setLiquidityWarningOpen(false);
    setLiquidityWarningContext(null);
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
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
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
          isLoading={isSigning || isApproving || isConfirming || isCheckingLiquidity || isExecuting}
          progressSteps={walletSteps}
          showProgress={!embedded && (isSigning || isApproving || isConfirming || (isError && partialFailure))}
          isSuccess={isSuccess}
          isPartialFailure={isError && partialFailure}
          errorMessage={isError && partialFailure ? error ?? undefined : undefined}
          txHash={effectiveCurrentTxHash ?? txHash}
          onSuccessComplete={onSuccessComplete}
          embedded={embedded}
          onCancel={() => {
            if (isSigning || isApproving || isConfirming) {
              setStatus('preview');
              setCurrentTxHash(null);
              setStepsInfo([]);
              setTotalSteps(0);
              setCurrentStepIndex(0);
              currentStepRef.current = 0;
              setIsExecuting(false);
              executingRef.current = false;
              setPartialFailure(false);
            } else if (isSuccess) {
              if (onSuccessComplete) {
                onSuccessComplete();
              } else if (onSuccess) {
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
            } else if (onReturnToIdle) {
              onReturnToIdle();
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
          onClose={handleLiquidityWarningClose}
          onForceWithdraw={
            liquidityWarningContext.forceWithdrawAvailable
              ? handleLiquidityWarningForceWithdraw
              : undefined
          }
          morphoVaultUrl={liquidityWarningContext.morphoVaultUrl}
          requestedAmountLabel={liquidityWarningContext.requestedAmountLabel}
          instantLiquidityLabel={liquidityWarningContext.instantLiquidityLabel}
          estimatedPenaltyLabel={liquidityWarningContext.estimatedPenaltyLabel}
          penaltyRateLabel={liquidityWarningContext.penaltyRateLabel}
          expectedOutLabel={liquidityWarningContext.expectedOutLabel}
          forceWithdrawAvailable={liquidityWarningContext.forceWithdrawAvailable}
          mayLeaveShareDust={liquidityWarningContext.mayLeaveShareDust}
          isPreparingForce={isExecuting}
        />
      )}
    </div>
  );
}

