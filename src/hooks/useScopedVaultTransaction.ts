'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useBalance, usePublicClient, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useTransactionState } from '@/contexts/TransactionContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { BASE_CHAIN_ID, TOKEN_ADDRESSES } from '@/lib/constants';
import { formatBigIntForInput } from '@/lib/formatter';
import { ERC20_BALANCE_ABI, ERC4626_ABI } from '@/lib/abis';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';
import { parseTransactionAmount } from '@/lib/liquidity-utils';
import {
  accountsMatchTransactionTab,
  getTokenBalanceRaw,
  isWethVault,
} from '@/lib/transaction-form-utils';
import { useVaultDepositCapacity } from '@/hooks/useVaultDepositCapacity';
import {
  canReceiveWethUnwrap,
  maxDepositForFunding,
  type DepositFunding,
} from '@/lib/native-eth';
import type { VaultAccount, WalletAccount } from '@/types/vault';

export type VaultTransactionTab = 'deposit' | 'withdraw';

interface UseScopedVaultTransactionOptions {
  vaultAddress: string;
  vaultName: string;
  vaultSymbol: string;
  isOpen: boolean;
  initialTab: VaultTransactionTab;
}

function buildWalletAccount(symbol: string): WalletAccount {
  return {
    type: 'wallet',
    address: 'wallet',
    symbol,
    balance: BigInt(0),
  };
}

function buildVaultAccount(
  vaultAddress: string,
  vaultName: string,
  vaultSymbol: string,
  shares: string | undefined
): VaultAccount {
  let balance = BigInt(0);
  if (shares) {
    try {
      const parsed = BigInt(shares);
      if (parsed > BigInt(0)) balance = parsed;
    } catch {
      // ignore invalid share strings
    }
  }

  return {
    type: 'vault',
    address: vaultAddress,
    name: vaultName,
    symbol: vaultSymbol,
    balance,
    assetAddress: '',
    assetDecimals: getAssetDecimalsForSymbol(vaultSymbol),
  };
}

export function useScopedVaultTransaction({
  vaultAddress,
  vaultName,
  vaultSymbol,
  isOpen,
  initialTab,
}: UseScopedVaultTransactionOptions) {
  const { isConnected, address: walletAddress } = useAccount();
  const { tokenBalances, morphoHoldings, refreshBalances } = useWallet();
  const { fetchVaultData } = useVaultData();
  const {
    fromAccount,
    toAccount,
    amount,
    status,
    derivedAsset,
    preferredAsset,
    setFromAccount,
    setToAccount,
    setAmount,
    setStatus,
    setPreferredAsset,
    reset,
  } = useTransactionState();
  const wethVault = isWethVault(vaultAddress, vaultSymbol);

  const [activeTab, setActiveTab] = useState<VaultTransactionTab>(initialTab);
  /** Amount the Deposit click lowered to the cap. Cleared once the user edits the amount. */
  const [depositCapAppliedRaw, setDepositCapAppliedRaw] = useState<bigint | null>(null);
  const [isCheckingDepositCap, setIsCheckingDepositCap] = useState(false);
  const initializedRef = useRef(false);
  const vaultKeyRef = useRef(vaultAddress);

  const vaultPosition = useMemo(
    () =>
      morphoHoldings.positions.find(
        (pos) => pos.vault.address.toLowerCase() === vaultAddress.toLowerCase()
      ) ?? null,
    [morphoHoldings.positions, vaultAddress]
  );

  // Share balance read on chain, so a withdraw still works when the Morpho positions API
  // fails or has not indexed this vault yet. Falls back to the API value while it loads.
  const { data: onChainShares, refetch: refetchOnChainShares } = useReadContract({
    address: walletAddress ? (vaultAddress as `0x${string}`) : undefined,
    chainId: BASE_CHAIN_ID,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress },
  });
  // The wallet's balance of the vault asset, read on chain: deposits never size off an API.
  const assetTokenAddress = useMemo(() => {
    const key = Object.keys(TOKEN_ADDRESSES).find(
      (symbol) => symbol.toLowerCase() === vaultSymbol.toLowerCase()
    ) as keyof typeof TOKEN_ADDRESSES | undefined;
    return key ? TOKEN_ADDRESSES[key] : undefined;
  }, [vaultSymbol]);
  const { data: onChainAssetBalance, refetch: refetchOnChainAssetBalance } = useReadContract({
    address: walletAddress && assetTokenAddress ? (assetTokenAddress as `0x${string}`) : undefined,
    chainId: BASE_CHAIN_ID,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress && !!assetTokenAddress },
  });

  // Native ETH, for ETH and ETH + WETH deposits into a WETH vault.
  const { data: onChainEthBalance, refetch: refetchOnChainEthBalance } = useBalance({
    address: walletAddress,
    chainId: BASE_CHAIN_ID,
    query: { enabled: !!walletAddress && wethVault },
  });

  // Smart wallets cannot receive WETH's unwrap (2300-gas transfer): withdraw as ETH is hidden
  // for them. `null` (read failed) keeps the option; the send path checks again.
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const { data: canUnwrapToEth } = useQuery({
    queryKey: ['weth-unwrap-receiver', walletAddress],
    queryFn: () => canReceiveWethUnwrap(publicClient!, walletAddress!),
    enabled: !!publicClient && !!walletAddress && wethVault,
    staleTime: 5 * 60_000,
  });
  const ethExitUnavailable = canUnwrapToEth === false;

  // Re-read after every positions refresh (the app refreshes after each transaction).
  useEffect(() => {
    if (!walletAddress) return;
    void refetchOnChainShares();
    void refetchOnChainAssetBalance();
    if (wethVault) void refetchOnChainEthBalance();
  }, [
    walletAddress,
    wethVault,
    morphoHoldings.positions,
    refetchOnChainShares,
    refetchOnChainAssetBalance,
    refetchOnChainEthBalance,
  ]);

  const vaultShareBalance =
    onChainShares !== undefined ? onChainShares.toString() : vaultPosition?.shares ?? null;

  const vaultShareBalanceBn = useMemo((): bigint | null => {
    if (!vaultShareBalance) return null;
    try {
      return BigInt(vaultShareBalance);
    } catch {
      return null;
    }
  }, [vaultShareBalance]);

  const vaultAccount = useMemo(
    () => buildVaultAccount(vaultAddress, vaultName, vaultSymbol, vaultShareBalance ?? undefined),
    [vaultAddress, vaultName, vaultSymbol, vaultShareBalance]
  );

  const walletAccount = useMemo(
    () => buildWalletAccount(vaultSymbol),
    [vaultSymbol]
  );

  const effectiveActiveTab = useMemo((): VaultTransactionTab => {
    if (status === 'idle' && fromAccount && toAccount) {
      if (fromAccount.type === 'wallet' && toAccount.type === 'vault') return 'deposit';
      if (fromAccount.type === 'vault' && toAccount.type === 'wallet') return 'withdraw';
    }
    return activeTab;
  }, [status, fromAccount, toAccount, activeTab]);

  useEffect(() => {
    if (ethExitUnavailable && effectiveActiveTab === 'withdraw' && preferredAsset === 'ETH') {
      setPreferredAsset('WETH');
    }
  }, [ethExitUnavailable, effectiveActiveTab, preferredAsset, setPreferredAsset]);

  const { capRaw: depositCapRaw, readCapForSubmit } = useVaultDepositCapacity(
    vaultAddress,
    isOpen && effectiveActiveTab === 'deposit'
  );

  const applyTabAccounts = useCallback(
    (tab: VaultTransactionTab) => {
      if (tab === 'deposit') {
        setFromAccount(walletAccount);
        setToAccount(vaultAccount);
      } else {
        setFromAccount(vaultAccount);
        setToAccount(walletAccount);
      }
    },
    [
      vaultAccount,
      walletAccount,
      setFromAccount,
      setToAccount,
    ]
  );

  useEffect(() => {
    if (vaultKeyRef.current !== vaultAddress) {
      vaultKeyRef.current = vaultAddress;
      initializedRef.current = false;
    }
  }, [vaultAddress]);

  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = false;
      return;
    }

    if (initializedRef.current) return;
    initializedRef.current = true;

    const contextVaultAddress =
      fromAccount?.type === 'vault'
        ? fromAccount.address
        : toAccount?.type === 'vault'
          ? toAccount.address
          : null;
    const sameVault =
      Boolean(contextVaultAddress) &&
      contextVaultAddress!.toLowerCase() === vaultAddress.toLowerCase();
    const inFlight =
      status !== 'idle' && status !== 'success' && status !== 'error';

    // Keep an in-flight review only when it already targets this vault.
    if (inFlight && sameVault) return;

    reset();
    setAmount('');
    applyTabAccounts(initialTab);

    if (isConnected) {
      refreshBalances();
      fetchVaultData(vaultAddress, BASE_CHAIN_ID, true);
    }
  }, [
    isOpen,
    initialTab,
    vaultAddress,
    isConnected,
    status,
    fromAccount,
    toAccount,
    reset,
    setAmount,
    applyTabAccounts,
    refreshBalances,
    fetchVaultData,
  ]);

  const handleTabChange = useCallback(
    (tab: VaultTransactionTab) => {
      if (status !== 'idle') return;
      if (
        tab === activeTab &&
        accountsMatchTransactionTab(tab, fromAccount, toAccount)
      ) {
        return;
      }
      setActiveTab(tab);
      setAmount('');
      setDepositCapAppliedRaw(null);
      setPreferredAsset('WETH');
      applyTabAccounts(tab);
    },
    [
      status,
      activeTab,
      fromAccount,
      toAccount,
      setAmount,
      setPreferredAsset,
      applyTabAccounts,
    ]
  );

  /** WETH vaults: pick WETH / ETH / ETH + WETH (deposit) or WETH / ETH (withdraw). */
  const handlePreferredAssetChange = useCallback(
    (asset: DepositFunding) => {
      if (status !== 'idle' || !wethVault) return;
      setDepositCapAppliedRaw(null);
      setPreferredAsset(asset);
    },
    [status, wethVault, setPreferredAsset]
  );

  const { data: exactAssetAmount, isPending: isExactAssetAmountPending } = useReadContract({
    address:
      effectiveActiveTab === 'withdraw' && vaultShareBalanceBn !== null
        ? (vaultAddress as `0x${string}`)
        : undefined,
    chainId: BASE_CHAIN_ID,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: vaultShareBalanceBn !== null ? [vaultShareBalanceBn] : undefined,
    query: {
      enabled:
        isOpen &&
        effectiveActiveTab === 'withdraw' &&
        vaultShareBalanceBn !== null &&
        vaultShareBalanceBn > BigInt(0),
    },
  });

  const isWithdrawMaxLoading = useMemo(() => {
    if (effectiveActiveTab !== 'withdraw') return false;
    if (vaultShareBalanceBn === null || vaultShareBalanceBn === BigInt(0)) return false;
    return exactAssetAmount === undefined && isExactAssetAmountPending;
  }, [
    effectiveActiveTab,
    vaultShareBalanceBn,
    exactAssetAmount,
    isExactAssetAmountPending,
  ]);

  const maxAmountRaw = useMemo((): bigint | null => {
    if (!derivedAsset) return null;

    if (effectiveActiveTab === 'deposit') {
      if (wethVault) {
        // On-chain reads; wallet state only while they load.
        const weth = onChainAssetBalance ?? getTokenBalanceRaw('WETH', tokenBalances);
        const eth = onChainEthBalance?.value ?? getTokenBalanceRaw('ETH', tokenBalances);
        return maxDepositForFunding(preferredAsset, weth, eth);
      }
      if (onChainAssetBalance !== undefined) return onChainAssetBalance;
      // Only while the on-chain read loads (or for an asset without a known token address).
      if (derivedAsset.symbol === 'WETH') {
        return getTokenBalanceRaw('WETH', tokenBalances);
      }
      return getTokenBalanceRaw(derivedAsset.symbol, tokenBalances);
    }

    if (vaultShareBalanceBn === null || vaultShareBalanceBn === BigInt(0)) {
      return BigInt(0);
    }
    if (exactAssetAmount !== undefined) return exactAssetAmount;
    if (isExactAssetAmountPending) return null;
    return BigInt(0);
  }, [
    derivedAsset,
    effectiveActiveTab,
    wethVault,
    preferredAsset,
    tokenBalances,
    onChainAssetBalance,
    onChainEthBalance,
    vaultShareBalanceBn,
    exactAssetAmount,
    isExactAssetAmountPending,
  ]);

  const maxAmount = useMemo((): number | null => {
    if (maxAmountRaw === null || !derivedAsset) return null;
    const decimals =
      effectiveActiveTab === 'withdraw'
        ? getAssetDecimalsForSymbol(vaultSymbol)
        : derivedAsset.decimals;
    return parseFloat(formatUnits(maxAmountRaw, decimals));
  }, [maxAmountRaw, derivedAsset, effectiveActiveTab, vaultSymbol]);

  /** MAX fills the wallet balance, or the vault's deposit cap when that is lower. */
  const maxInputRaw = useMemo((): bigint | null => {
    if (maxAmountRaw === null) return null;
    if (effectiveActiveTab !== 'deposit' || depositCapRaw === null) return maxAmountRaw;
    return depositCapRaw < maxAmountRaw ? depositCapRaw : maxAmountRaw;
  }, [maxAmountRaw, effectiveActiveTab, depositCapRaw]);

  const calculateMaxAmount = useCallback(() => {
    setDepositCapAppliedRaw(null);
    if (maxInputRaw === null) {
      setAmount('0');
      return;
    }
    if (maxInputRaw === BigInt(0)) {
      setAmount('0');
      return;
    }

    const symbol = derivedAsset?.symbol || vaultSymbol;
    const decimals =
      effectiveActiveTab === 'withdraw'
        ? getAssetDecimalsForSymbol(vaultSymbol)
        : getAssetDecimalsForSymbol(symbol);

    setAmount(formatBigIntForInput(maxInputRaw, decimals));
  }, [
    maxInputRaw,
    effectiveActiveTab,
    derivedAsset,
    vaultSymbol,
    setAmount,
  ]);

  const handleAmountChange = useCallback(
    (value: string) => {
      if (value === '') {
        setDepositCapAppliedRaw(null);
        setAmount('');
        return;
      }
      if (!/^\d*\.?\d*$/.test(value)) return;
      setDepositCapAppliedRaw(null);
      const decimals = derivedAsset?.decimals ?? getAssetDecimalsForSymbol(vaultSymbol);
      const dot = value.indexOf('.');
      if (dot >= 0 && value.length - dot - 1 > decimals) {
        setAmount(value.slice(0, dot + 1 + decimals));
        return;
      }
      setAmount(value);
    },
    [setAmount, derivedAsset?.decimals, vaultSymbol]
  );

  const exceedsBalance = useMemo(() => {
    if (!amount || !derivedAsset || maxAmountRaw === null) return false;
    const entered = parseTransactionAmount(amount.replace(/\.$/, ''), derivedAsset.decimals);
    if (entered <= BigInt(0)) return false;
    return entered > maxAmountRaw;
  }, [amount, derivedAsset, maxAmountRaw]);

  const hasValidAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) && parsed > 0;
  }, [amount]);

  const isDepositTab = effectiveActiveTab === 'deposit';
  const depositCapFull = isDepositTab && depositCapRaw === BigInt(0);

  const exceedsDepositCap = useMemo(() => {
    if (!isDepositTab || depositCapRaw === null || exceedsBalance) return false;
    if (!amount || !derivedAsset) return false;
    const entered = parseTransactionAmount(amount.replace(/\.$/, ''), derivedAsset.decimals);
    return entered > depositCapRaw;
  }, [isDepositTab, depositCapRaw, exceedsBalance, amount, derivedAsset]);

  const depositCapApplied = useMemo(() => {
    if (!isDepositTab || depositCapAppliedRaw === null || !derivedAsset) return null;
    const entered = parseTransactionAmount(amount.replace(/\.$/, ''), derivedAsset.decimals);
    return entered === depositCapAppliedRaw ? depositCapAppliedRaw : null;
  }, [isDepositTab, depositCapAppliedRaw, derivedAsset, amount]);

  const blockContinueForBalance = exceedsBalance;

  const handleStartTransaction = useCallback(async () => {
    if (!fromAccount || !toAccount || !derivedAsset || !hasValidAmount || exceedsBalance) return;

    if (isDepositTab) {
      setIsCheckingDepositCap(true);
      let freshCapRaw: bigint | null;
      try {
        freshCapRaw = await readCapForSubmit();
      } finally {
        setIsCheckingDepositCap(false);
      }

      if (freshCapRaw !== null) {
        if (freshCapRaw === BigInt(0)) return;
        const entered = parseTransactionAmount(amount.replace(/\.$/, ''), derivedAsset.decimals);
        if (entered > freshCapRaw) {
          setAmount(formatBigIntForInput(freshCapRaw, derivedAsset.decimals));
          setDepositCapAppliedRaw(freshCapRaw);
          return;
        }
      }
    }

    setStatus('preview');
  }, [
    fromAccount,
    toAccount,
    derivedAsset,
    hasValidAmount,
    exceedsBalance,
    isDepositTab,
    readCapForSubmit,
    amount,
    setAmount,
    setStatus,
  ]);

  const handleResetToIdle = useCallback(() => {
    reset();
    setAmount('');
    setDepositCapAppliedRaw(null);
    applyTabAccounts(activeTab);
  }, [reset, setAmount, activeTab, applyTabAccounts]);

  const handleReturnToIdle = useCallback(() => {
    setStatus('idle');
  }, [setStatus]);

  const getProgressSteps = useCallback(() => {
    const baseSteps = [
      { label: 'Amount', completed: false, active: false },
      { label: 'Review', completed: false, active: false },
      { label: 'Confirmation', completed: false, active: false },
    ];

    if (status === 'success') {
      return baseSteps.map((step) => ({ ...step, completed: true }));
    }
    if (status === 'preview') {
      return [
        { ...baseSteps[0], completed: true },
        { ...baseSteps[1], active: true },
        baseSteps[2],
      ];
    }
    if (status === 'signing' || status === 'approving' || status === 'confirming') {
      return [
        { ...baseSteps[0], completed: true },
        { ...baseSteps[1], active: true },
        baseSteps[2],
      ];
    }
    return [{ ...baseSteps[0], active: true }, baseSteps[1], baseSteps[2]];
  }, [status]);

  const canClose =
    status === 'idle' || status === 'success' || status === 'error';

  return {
    isConnected,
    activeTab,
    effectiveActiveTab,
    handleTabChange,
    amount,
    handleAmountChange,
    calculateMaxAmount,
    maxAmount,
    handleStartTransaction,
    hasValidAmount,
    exceedsBalance,
    blockContinueForBalance,
    depositCapRaw: isDepositTab ? depositCapRaw : null,
    depositCapFull,
    exceedsDepositCap,
    depositCapAppliedRaw: depositCapApplied,
    isCheckingDepositCap,
    derivedAsset,
    fromAccount,
    toAccount,
    status,
    getProgressSteps,
    handleResetToIdle,
    handleReturnToIdle,
    canClose,
    isWithdrawMaxLoading,
    vaultAddress,
    vaultSymbol,
    isWethVault: wethVault,
    ethExitUnavailable,
    preferredAsset,
    handlePreferredAssetChange,
  };
}
