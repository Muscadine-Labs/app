'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useTransactionState } from '@/contexts/TransactionContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { ETH_GAS_RESERVE_WEI, BASE_CHAIN_ID } from '@/lib/constants';
import { formatBigIntForInput } from '@/lib/formatter';
import { ERC4626_ABI } from '@/lib/abis';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';
import { parseTransactionAmount } from '@/lib/liquidity-utils';
import {
  accountsMatchTransactionTab,
  getTokenBalanceRaw,
  isWethVault,
} from '@/lib/transaction-form-utils';
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
  const { isConnected } = useAccount();
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

  const [activeTab, setActiveTab] = useState<VaultTransactionTab>(initialTab);
  const initializedRef = useRef(false);
  const vaultKeyRef = useRef(vaultAddress);

  const vaultPosition = useMemo(
    () =>
      morphoHoldings.positions.find(
        (pos) => pos.vault.address.toLowerCase() === vaultAddress.toLowerCase()
      ) ?? null,
    [morphoHoldings.positions, vaultAddress]
  );

  const vaultShareBalance = vaultPosition?.shares ?? null;

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

  const applyTabAccounts = useCallback(
    (tab: VaultTransactionTab) => {
      if (tab === 'deposit') {
        setFromAccount(walletAccount);
        setToAccount(vaultAccount);
        if (isWethVault(vaultAddress, vaultSymbol)) {
          setPreferredAsset('WETH');
        } else {
          setPreferredAsset(undefined);
        }
      } else {
        setFromAccount(vaultAccount);
        setToAccount(walletAccount);
        if (isWethVault(vaultAddress, vaultSymbol)) {
          setPreferredAsset('WETH');
        } else {
          setPreferredAsset(undefined);
        }
      }
    },
    [
      vaultAccount,
      walletAccount,
      vaultAddress,
      vaultSymbol,
      setFromAccount,
      setToAccount,
      setPreferredAsset,
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
      applyTabAccounts(tab);
    },
    [
      status,
      activeTab,
      fromAccount,
      toAccount,
      setAmount,
      applyTabAccounts,
    ]
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

  const getWrappableEthRaw = useCallback((): bigint => {
    const ethWei = getTokenBalanceRaw('ETH', tokenBalances);
    return ethWei > ETH_GAS_RESERVE_WEI ? ethWei - ETH_GAS_RESERVE_WEI : BigInt(0);
  }, [tokenBalances]);

  const combinedEthWethRaw = useMemo(
    () => getTokenBalanceRaw('WETH', tokenBalances) + getWrappableEthRaw(),
    [tokenBalances, getWrappableEthRaw]
  );

  const isWethVaultEthDeposit = useMemo(() => {
    if (effectiveActiveTab !== 'deposit') return false;
    const assetPreference = preferredAsset || 'WETH';
    return (
      isWethVault(vaultAddress, vaultSymbol) &&
      (assetPreference === 'ETH' || assetPreference === 'ALL')
    );
  }, [effectiveActiveTab, vaultAddress, vaultSymbol, preferredAsset]);

  const maxAmountRaw = useMemo((): bigint | null => {
    if (!derivedAsset) return null;

    if (effectiveActiveTab === 'deposit') {
      if (isWethVault(vaultAddress, vaultSymbol)) {
        const assetPreference = preferredAsset || 'WETH';
        if (assetPreference === 'ETH') return getWrappableEthRaw();
        if (assetPreference === 'WETH') {
          return getTokenBalanceRaw('WETH', tokenBalances);
        }
        return combinedEthWethRaw;
      }

      if (derivedAsset.symbol === 'ETH') return getWrappableEthRaw();
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
    vaultAddress,
    vaultSymbol,
    preferredAsset,
    tokenBalances,
    vaultShareBalanceBn,
    exactAssetAmount,
    isExactAssetAmountPending,
    combinedEthWethRaw,
    getWrappableEthRaw,
  ]);

  const maxAmount = useMemo((): number | null => {
    if (maxAmountRaw === null || !derivedAsset) return null;
    const decimals =
      effectiveActiveTab === 'withdraw'
        ? getAssetDecimalsForSymbol(vaultSymbol)
        : derivedAsset.decimals;
    return parseFloat(formatUnits(maxAmountRaw, decimals));
  }, [maxAmountRaw, derivedAsset, effectiveActiveTab, vaultSymbol]);

  const calculateMaxAmount = useCallback(() => {
    if (maxAmountRaw === null) {
      setAmount('0');
      return;
    }
    if (maxAmountRaw === BigInt(0)) {
      setAmount('0');
      return;
    }

    const symbol = derivedAsset?.symbol || vaultSymbol;
    const decimals =
      effectiveActiveTab === 'withdraw'
        ? getAssetDecimalsForSymbol(vaultSymbol)
        : getAssetDecimalsForSymbol(symbol);

    setAmount(formatBigIntForInput(maxAmountRaw, decimals));
  }, [
    maxAmountRaw,
    effectiveActiveTab,
    derivedAsset,
    vaultSymbol,
    setAmount,
  ]);

  const handleAmountChange = useCallback(
    (value: string) => {
      if (value === '') {
        setAmount('');
        return;
      }
      if (!/^\d*\.?\d*$/.test(value)) return;
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

  const blockContinueForBalance = exceedsBalance;

  const handleStartTransaction = useCallback(() => {
    if (fromAccount && toAccount && derivedAsset && hasValidAmount && !exceedsBalance) {
      setStatus('preview');
    }
  }, [fromAccount, toAccount, derivedAsset, hasValidAmount, exceedsBalance, setStatus]);

  const handleResetToIdle = useCallback(() => {
    reset();
    setAmount('');
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
    preferredAsset,
    setPreferredAsset,
    isWethVaultEthDeposit,
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
  };
}
