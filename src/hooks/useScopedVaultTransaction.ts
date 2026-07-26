'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useTransactionState } from '@/contexts/TransactionContext';
import { TOKEN_ADDRESSES_LOWER, useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useVaultVersion } from '@/contexts/VaultVersionContext';
import { ETH_GAS_RESERVE, BASE_CHAIN_ID } from '@/lib/constants';
import {
  formatAssetAmountForMax,
  formatAvailableBalance,
  formatBigIntForInput,
} from '@/lib/formatter';
import { ERC4626_ABI } from '@/lib/abis';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';
import {
  findTokenBySymbol,
  getTokenBalanceAmount,
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
  const { tokenBalances, ethBalance, morphoHoldings, refreshBalances } = useWallet();
  const { fetchVaultData } = useVaultData();
  const { isDevMode } = useVaultVersion();
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
  const [balanceBypassAcknowledged, setBalanceBypassAcknowledged] = useState(false);
  const initializedRef = useRef(false);

  const vaultPosition = useMemo(
    () =>
      morphoHoldings.positions.find(
        (pos) => pos.vault.address.toLowerCase() === vaultAddress.toLowerCase()
      ) ?? null,
    [morphoHoldings.positions, vaultAddress]
  );

  const vaultShareBalance = vaultPosition?.shares ?? null;

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
          setPreferredAsset('ALL');
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
    if (!isOpen) {
      initializedRef.current = false;
      return;
    }

    if (initializedRef.current) return;
    initializedRef.current = true;

    reset();
    setActiveTab(initialTab);
    setAmount('');
    setBalanceBypassAcknowledged(false);
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
    reset,
    setAmount,
    applyTabAccounts,
    refreshBalances,
    fetchVaultData,
  ]);

  const handleTabChange = useCallback(
    (tab: VaultTransactionTab) => {
      if (status !== 'idle' || tab === activeTab) return;
      setActiveTab(tab);
      setAmount('');
      setBalanceBypassAcknowledged(false);
      applyTabAccounts(tab);
    },
    [status, activeTab, setAmount, applyTabAccounts]
  );

  const { data: exactAssetAmount } = useReadContract({
    address:
      effectiveActiveTab === 'withdraw' && vaultShareBalance
        ? (vaultAddress as `0x${string}`)
        : undefined,
    chainId: BASE_CHAIN_ID,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: vaultShareBalance ? [BigInt(vaultShareBalance)] : undefined,
    query: {
      enabled:
        isOpen &&
        effectiveActiveTab === 'withdraw' &&
        !!vaultShareBalance &&
        BigInt(vaultShareBalance) > BigInt(0),
    },
  });

  const getWrappableEthBalance = useCallback(() => {
    const ethBal = parseFloat(ethBalance || '0');
    if (isDevMode) return ethBal;
    return Math.max(0, ethBal - ETH_GAS_RESERVE);
  }, [ethBalance, isDevMode]);

  const getCombinedEthWethBalance = useMemo(() => {
    const wethBal = getTokenBalanceAmount('WETH', tokenBalances);
    return wethBal + getWrappableEthBalance();
  }, [tokenBalances, getWrappableEthBalance]);

  const isWethVaultEthDeposit = useMemo(() => {
    if (effectiveActiveTab !== 'deposit') return false;
    const assetPreference = preferredAsset || 'ALL';
    return (
      isWethVault(vaultAddress, vaultSymbol) &&
      (assetPreference === 'ETH' || assetPreference === 'ALL')
    );
  }, [effectiveActiveTab, vaultAddress, vaultSymbol, preferredAsset]);

  const getWalletBalanceText = useMemo(() => {
    if (!derivedAsset) return '';

    if (
      effectiveActiveTab === 'deposit' &&
      isWethVault(vaultAddress, vaultSymbol) &&
      (derivedAsset.symbol === 'WETH' || derivedAsset.symbol === 'ETH')
    ) {
      const combinedBal = getCombinedEthWethBalance;
      const ethBal = parseFloat(ethBalance || '0');
      const wethBal = getTokenBalanceAmount('WETH', tokenBalances);

      if (wethBal > 0 && ethBal > 0) {
        const wrappableEth = getWrappableEthBalance();
        return `${formatAvailableBalance(combinedBal, 'WETH')} (${formatAvailableBalance(wethBal, 'WETH')} + ${formatAvailableBalance(wrappableEth, 'ETH')} wrappable)`;
      }
      if (wethBal > 0) {
        return formatAvailableBalance(wethBal, 'WETH');
      }
      if (ethBal > 0) {
        return `${formatAvailableBalance(getWrappableEthBalance(), 'ETH')} (wrappable to WETH)`;
      }
      return formatAvailableBalance('0', 'WETH');
    }

    if (derivedAsset.symbol === 'ETH' || derivedAsset.symbol === 'WETH') {
      return formatAvailableBalance(ethBalance || '0', derivedAsset.symbol);
    }

    const token = findTokenBySymbol(derivedAsset.symbol, tokenBalances);
    if (token) {
      return formatAvailableBalance(
        formatUnits(token.balance, token.decimals),
        derivedAsset.symbol,
        token.decimals
      );
    }
    return formatAvailableBalance('0', derivedAsset.symbol);
  }, [
    derivedAsset,
    effectiveActiveTab,
    vaultAddress,
    vaultSymbol,
    ethBalance,
    tokenBalances,
    getCombinedEthWethBalance,
    getWrappableEthBalance,
  ]);

  const getVaultBalanceText = useMemo(() => {
    if (!derivedAsset || effectiveActiveTab !== 'withdraw') return '';

    const assetDecimals = getAssetDecimalsForSymbol(vaultSymbol);

    if (!vaultShareBalance) {
      if (morphoHoldings.isLoading) return 'Loading...';
      return `Available: 0.00 ${derivedAsset.symbol}`;
    }

    if (BigInt(vaultShareBalance) === BigInt(0)) {
      return `Available: 0.00 ${derivedAsset.symbol}`;
    }

    if (exactAssetAmount !== undefined) {
      const assetAmount = parseFloat(formatUnits(exactAssetAmount, assetDecimals));
      return formatAvailableBalance(assetAmount, derivedAsset.symbol, assetDecimals);
    }

    return 'Loading...';
  }, [
    derivedAsset,
    effectiveActiveTab,
    vaultSymbol,
    vaultShareBalance,
    exactAssetAmount,
    morphoHoldings.isLoading,
  ]);

  const getMaxAmount = useMemo((): number | null => {
    if (!derivedAsset) return null;

    if (effectiveActiveTab === 'deposit') {
      if (isWethVault(vaultAddress, vaultSymbol)) {
        const assetPreference = preferredAsset || 'ALL';
        if (assetPreference === 'ETH') return getWrappableEthBalance();
        if (assetPreference === 'WETH') {
          return getTokenBalanceAmount('WETH', tokenBalances);
        }
        return getCombinedEthWethBalance;
      }

      if (derivedAsset.symbol === 'ETH') return getWrappableEthBalance();
      if (derivedAsset.symbol === 'WETH') {
        return getTokenBalanceAmount('WETH', tokenBalances);
      }

      return getTokenBalanceAmount(derivedAsset.symbol, tokenBalances);
    }

    const assetDecimals = getAssetDecimalsForSymbol(vaultSymbol);
    if (!vaultShareBalance || BigInt(vaultShareBalance) === BigInt(0)) return 0;
    if (exactAssetAmount !== undefined) {
      return parseFloat(formatUnits(exactAssetAmount, assetDecimals));
    }
    return 0;
  }, [
    derivedAsset,
    effectiveActiveTab,
    vaultAddress,
    vaultSymbol,
    preferredAsset,
    tokenBalances,
    vaultShareBalance,
    exactAssetAmount,
    getCombinedEthWethBalance,
    getWrappableEthBalance,
  ]);

  const calculateMaxAmount = useCallback(() => {
    const maxAmount = getMaxAmount;
    if (maxAmount === null || maxAmount === 0) {
      setAmount('0');
      return;
    }

    if (effectiveActiveTab === 'deposit') {
      const symbol = derivedAsset?.symbol || vaultSymbol;
      const decimals = getAssetDecimalsForSymbol(symbol);

      if (isWethVault(vaultAddress, vaultSymbol)) {
        const assetPreference = preferredAsset || 'ALL';
        if (assetPreference === 'ETH') {
          setAmount(
            maxAmount > 0 ? formatAssetAmountForMax(maxAmount, 'ETH', decimals) : '0'
          );
          return;
        }
        if (assetPreference === 'WETH') {
          const wethToken = tokenBalances.find(
            (t) => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH
          );
          setAmount(
            wethToken ? formatBigIntForInput(wethToken.balance, wethToken.decimals) : '0'
          );
          return;
        }
      }

      if (symbol === 'ETH') {
        setAmount(maxAmount > 0 ? formatAssetAmountForMax(maxAmount, symbol) : '0');
        return;
      }

      if (symbol === 'WETH') {
        const wethToken = tokenBalances.find(
          (t) => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH
        );
        setAmount(
          wethToken ? formatBigIntForInput(wethToken.balance, wethToken.decimals) : '0'
        );
        return;
      }

      const token = findTokenBySymbol(symbol, tokenBalances);
      setAmount(token ? formatBigIntForInput(token.balance, token.decimals) : '0');
      return;
    }

    const decimals = getAssetDecimalsForSymbol(vaultSymbol);
    setAmount(formatAssetAmountForMax(maxAmount, derivedAsset?.symbol || vaultSymbol, decimals));
  }, [
    getMaxAmount,
    effectiveActiveTab,
    derivedAsset,
    vaultSymbol,
    vaultAddress,
    tokenBalances,
    preferredAsset,
    setAmount,
  ]);

  const handleAmountChange = useCallback(
    (value: string) => {
      if (value === '') {
        setAmount('');
        return;
      }
      if (!/^\d*\.?\d*$/.test(value)) return;
      setAmount(value);
    },
    [setAmount]
  );

  const exceedsBalance = useMemo(() => {
    if (!amount || !derivedAsset) return false;
    const enteredAmount = parseFloat(amount);
    if (isNaN(enteredAmount) || enteredAmount <= 0) return false;
    const maxAmount = getMaxAmount;
    if (maxAmount === null) return false;
    return enteredAmount > maxAmount;
  }, [amount, derivedAsset, getMaxAmount]);

  const blockContinueForBalance =
    exceedsBalance && !(isDevMode && balanceBypassAcknowledged);

  const handleStartTransaction = useCallback(() => {
    if (fromAccount && toAccount && derivedAsset) {
      setStatus('preview');
    }
  }, [fromAccount, toAccount, derivedAsset, setStatus]);

  const handleResetToIdle = useCallback(() => {
    reset();
    setAmount('');
    setBalanceBypassAcknowledged(false);
    setActiveTab(initialTab);
    applyTabAccounts(initialTab);
  }, [reset, setAmount, initialTab, applyTabAccounts]);

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
    getMaxAmount,
    getWalletBalanceText,
    getVaultBalanceText,
    handleStartTransaction,
    exceedsBalance,
    blockContinueForBalance,
    balanceBypassAcknowledged,
    setBalanceBypassAcknowledged,
    preferredAsset,
    setPreferredAsset,
    isWethVaultEthDeposit,
    derivedAsset,
    fromAccount,
    toAccount,
    status,
    getProgressSteps,
    handleResetToIdle,
    canClose,
    isDevMode,
    vaultAddress,
    vaultSymbol,
  };
}
