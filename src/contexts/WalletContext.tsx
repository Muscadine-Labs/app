'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { useBalance } from 'wagmi';
import { formatUnits, getAddress, type PublicClient } from 'viem';
import { formatCurrency } from '@/lib/formatter';
import { logger } from '@/lib/logger';
import {
  clearPositionHistoryCache,
  markPositionHistoryTransaction,
} from '@/lib/position-history-cache';
import { BASE_CHAIN_ID, POST_TX_BALANCE_REFRESH_DELAY_MS } from '@/lib/constants';
import { ERC20_BALANCE_ABI } from '@/lib/abis';
import { usePrices } from '@/contexts/PriceContext';
import { fallbackRegistryAssets, readRegistryAssets, withFallbackAssets } from '@/lib/registry-assets';
import { findVaultByAddress } from '@/lib/vault-utils';
import { getRegistryVaultList, type VaultStrategy } from '@/lib/vaults';
import { readRegistryVaultBalances, type OnChainVaultBalance } from '@/lib/onchain-positions';
import { getAssetDecimalsForSymbol, rawAmountToDecimal } from '@/lib/asset-decimals';

export interface TokenBalance {
  address: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  formatted: string;
  usdValue: number;
}

interface VaultPosition {
  version: 'v1' | 'v2';
  vault: {
    address: string;
    name: string;
    symbol: string;
    vaultSymbol?: string;
    strategy?: VaultStrategy;
    isCurated?: boolean;
    state: {
      sharePriceUsd: number;
      totalAssetsUsd: number;
      totalSupply: string;
    };
  };
  shares: string;
  assets?: string;
  assetsUsd?: number;
  assetDecimals?: number;
  pnl?: number;
  pnlUsd?: number;
  pnlRaw?: string;
}

interface MorphoHoldings {
  totalValueUsd: number;
  positions: VaultPosition[];
  isLoading: boolean;
  error: string | null;
  /** Wallet whose positions fetch has finished (success or error). Null until then. */
  resolvedAddress: string | null;
}

interface WalletContextType {
  ethBalance: string;
  ethUsdValue: string;
  totalUsdValue: string;
  liquidUsdValue: string;
  morphoUsdValue: string;
  tokenBalances: TokenBalance[];
  morphoHoldings: MorphoHoldings;
  loading: boolean;
  error: string | null;
  refreshBalances: () => Promise<void>;
  /** Refresh only when this wallet's data is older than `maxAgeMs` and no refresh is running. */
  refreshBalancesIfStale: (maxAgeMs: number) => Promise<void>;
  refreshBalancesWithRetry: (options?: { maxRetries?: number; retryDelay?: number }) => Promise<void>;
  refreshBalancesWithPolling: (options?: { followUpDelayMs?: number; onComplete?: () => void | Promise<void> }) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

function isVaultShareTokenAddress(address: string, positionAddresses: Set<string>): boolean {
  if (address === 'ETH') return false;
  if (findVaultByAddress(address)) return true;
  return positionAddresses.has(address.toLowerCase());
}

function toTokenBalance(
  contractAddress: string,
  tokenBalance: string | undefined,
  decimals: number,
  symbol: string
): TokenBalance | null {
  try {
    const balance = BigInt(tokenBalance || '0');
    if (balance <= BigInt(0)) return null;
    return {
      address: contractAddress,
      symbol,
      decimals,
      balance,
      formatted: formatUnits(balance, decimals),
      usdValue: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Registry vault balances come from the chain: share balance and asset value replace the
 * Morpho API's (which can lag or fail), and a vault held on chain but missing from the API
 * gets a row. The API still supplies profit (pnl) and every non-registry vault. USD for a
 * registry row is filled from live prices later (`assetsUsd` undefined here).
 */
function mergeOnChainBalances(
  apiPositions: VaultPosition[],
  onChain: Record<string, OnChainVaultBalance> | null
): VaultPosition[] {
  if (!onChain) return apiPositions;
  const seen = new Set<string>();
  const merged = apiPositions.map((position) => {
    const key = position.vault.address.toLowerCase();
    const balance = onChain[key];
    if (!balance) return position;
    seen.add(key);
    return {
      ...position,
      shares: balance.shares.toString(),
      assets: balance.assets.toString(),
      assetsUsd: balance.assets === BigInt(0) ? 0 : undefined,
    };
  });
  for (const vault of getRegistryVaultList()) {
    const key = vault.address.toLowerCase();
    const balance = onChain[key];
    if (seen.has(key) || !balance || balance.shares === BigInt(0)) continue;
    merged.push({
      version: 'v2',
      vault: {
        address: vault.address,
        name: vault.name,
        symbol: vault.symbol,
        vaultSymbol: vault.vaultSymbol,
        strategy: vault.strategy,
        isCurated: true,
        state: { sharePriceUsd: 0, totalAssetsUsd: 0, totalSupply: '0' },
      },
      shares: balance.shares.toString(),
      assets: balance.assets.toString(),
      assetsUsd: undefined,
      assetDecimals: getAssetDecimalsForSymbol(vault.symbol),
    });
  }
  return merged;
}

async function readOnChainBalances(
  publicClient: PublicClient | undefined,
  wallet: string
): Promise<Record<string, OnChainVaultBalance> | null> {
  if (!publicClient) return null;
  try {
    // Asset decimals set the dust threshold; the symbol fallback covers a failed asset read.
    const registry = await readRegistryAssets(publicClient).catch(() => null);
    const decimals = registry
      ? Object.fromEntries(
          Object.entries(registry.byVault).map(([vault, asset]) => [vault, asset.decimals])
        )
      : undefined;
    return await readRegistryVaultBalances(publicClient, getAddress(wallet), decimals);
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const {
    priceOf,
    priceForVault,
    assetForVault,
    refresh: refreshPrices,
    assets: knownAssets,
  } = usePrices();
  /** Changes when the registry asset read lands or fills in a vault it missed. */
  const knownAssetsKey = knownAssets
    .map((a) => a.address.toLowerCase())
    .sort()
    .join(',');
  // Tagged with the wallet they belong to, so a failed read after a wallet switch never shows
  // the previous wallet's tokens.
  const [assetTokenState, setAssetTokenState] = useState<{ address: string | null; tokens: TokenBalance[] }>({
    address: null,
    tokens: [],
  });
  const [rawMorphoHoldings, setMorphoHoldings] = useState<MorphoHoldings>({
    totalValueUsd: 0,
    positions: [],
    isLoading: false,
    error: null,
    resolvedAddress: null,
  });
  
  // Debounced wallet state to prevent rapid state changes during auth flows
  const [stableIsConnected, setStableIsConnected] = useState(isConnected);
  const [stableAddress, setStableAddress] = useState(address);

  // Debounce wallet state changes to prevent clearing data during auth flows
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setStableIsConnected(isConnected);
      setStableAddress(address);
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [isConnected, address]);

  // Get ETH balance
  const { data: ethBalance, refetch: refetchEthBalance } = useBalance({
    address: address as `0x${string}`,
    query: { enabled: !!address }
  });

  // Wallet balances of every registry vault asset, in one multicall. The token list comes from
  // the vaults themselves (`asset()`), so a vault in a new token needs no change here.
  const fetchAllTokenBalances = useCallback(async (
    walletAddress: string | undefined
  ): Promise<{ tokens: TokenBalance[]; ok: boolean }> => {
    if (!walletAddress) return { tokens: [], ok: true };
    if (!publicClient) return { tokens: [], ok: false };
    try {
      // A failed asset read falls back to the known Base tokens rather than an empty wallet.
      const { assets } = await readRegistryAssets(publicClient)
        .then((read) => withFallbackAssets(read))
        .catch(() => fallbackRegistryAssets());
      if (assets.length === 0) return { tokens: [], ok: true };
      const wallet = getAddress(walletAddress);
      const results = await publicClient.multicall({
        allowFailure: true,
        contracts: assets.map((asset) => ({
          address: asset.address,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf' as const,
          args: [wallet] as const,
        })),
      });
      const tokens = assets
        .map((asset, i) => {
          const result = results[i];
          if (result.status !== 'success') return null;
          return toTokenBalance(asset.address, String(result.result), asset.decimals, asset.symbol);
        })
        .filter((balance): balance is TokenBalance => balance !== null);
      return { tokens, ok: results.every((r) => r.status === 'success') };
    } catch {
      return { tokens: [], ok: false };
    }
  }, [publicClient]);

  // Fetch all Morpho v2 vault positions from the API (curated + external).
  const morphoFetchIdRef = useRef(0);
  /** Last wallet refresh: whose, when it finished cleanly (0 = not yet / failed), and if one is running. */
  const refreshStateRef = useRef<{ address: string | null; at: number; inFlight: boolean }>({
    address: null,
    at: 0,
    inFlight: false,
  });
  const lastMorphoAddressRef = useRef<string | null>(null);
  const walletDataFetchIdRef = useRef(0);

  type MorphoFetchStatus = 'ok' | 'aborted' | 'retryable' | 'failed';

  const fetchVaultPositions = useCallback(async (requestedAddress?: string): Promise<MorphoFetchStatus> => {
    if (!requestedAddress) {
      morphoFetchIdRef.current += 1;
      lastMorphoAddressRef.current = null;
      setMorphoHoldings({
        totalValueUsd: 0,
        positions: [],
        isLoading: false,
        error: null,
        resolvedAddress: null,
      });
      return 'ok';
    }

    const fetchId = ++morphoFetchIdRef.current;
    const addressChanged =
      lastMorphoAddressRef.current?.toLowerCase() !== requestedAddress.toLowerCase();
    lastMorphoAddressRef.current = requestedAddress;

    setMorphoHoldings((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      // Drop prior wallet data immediately on switch; keep snapshot on same-wallet refresh.
      ...(addressChanged
        ? { positions: [], totalValueUsd: 0, resolvedAddress: null }
        : {}),
    }));

    const onChainPromise = readOnChainBalances(publicClient, requestedAddress);
    const url = `/api/user/morpho-positions?address=${encodeURIComponent(requestedAddress)}&chainId=${BASE_CHAIN_ID}&includeEmpty=true`;
    // Server already retries Morpho; keep client retries light and only when retryable.
    const maxAttempts = 2;
    const retryDelayMs = 750;

    const isCurrent = () =>
      fetchId === morphoFetchIdRef.current &&
      lastMorphoAddressRef.current?.toLowerCase() === requestedAddress.toLowerCase();

    try {
      let morphoResponse: Response | null = null;
      let lastFetchError: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (!isCurrent()) return 'aborted';
        try {
          morphoResponse = await fetch(url, { cache: 'no-store' });
          if (morphoResponse.ok || attempt === maxAttempts - 1) break;

          const retryableStatus =
            morphoResponse.status === 429 ||
            morphoResponse.status === 502 ||
            morphoResponse.status === 503 ||
            morphoResponse.status === 504;
          if (!retryableStatus) break;

          // Prefer server `retryable` flag when present.
          const peek = await morphoResponse.clone().json().catch(() => ({}));
          if (peek && peek.retryable === false) break;

          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        } catch (err) {
          lastFetchError = err;
          morphoResponse = null;
          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          }
        }
      }

      if (!isCurrent()) return 'aborted';

      if (!morphoResponse) {
        throw lastFetchError instanceof Error
          ? lastFetchError
          : new Error('Failed to fetch vault positions');
      }

      if (!morphoResponse.ok) {
        const body = await morphoResponse.json().catch(() => ({}));
        const message =
          typeof body?.error === 'string'
            ? body.error
            : `Morpho positions temporarily unavailable (${morphoResponse.status})`;
        logger.warn('Morpho positions fetch soft-failed', {
          address: requestedAddress,
          status: morphoResponse.status,
          message,
        });
        // Keep last successful snapshot for this wallet (already cleared on address change),
        // with registry balances from the chain. Always settle resolvedAddress so underlying
        // pages do not hang on Morpho errors.
        const onChain = await onChainPromise;
        if (!isCurrent()) return 'aborted';
        setMorphoHoldings((prev) => ({
          ...prev,
          positions: mergeOnChainBalances(prev.positions, onChain),
          isLoading: false,
          error: message,
          resolvedAddress: requestedAddress,
        }));
        const retryable =
          body?.retryable === true ||
          (body?.retryable !== false &&
            (morphoResponse.status === 429 ||
              morphoResponse.status === 502 ||
              morphoResponse.status === 503 ||
              morphoResponse.status === 504));
        return retryable ? 'retryable' : 'failed';
      }

      const morphoData = await morphoResponse.json();
      if (!isCurrent()) return 'aborted';

      const positions: VaultPosition[] = (morphoData.positions ?? []).map(
        (p: {
          version: 'v1' | 'v2';
          vault: {
            address: string;
            name: string;
            symbol: string;
            vaultSymbol?: string;
            strategy?: string;
            isCurated?: boolean;
          };
          shares: string;
          assets: string;
          assetsUsd: number;
          assetDecimals?: number;
          pnl?: number;
          pnlUsd?: number;
          pnlRaw?: string;
        }) => {
          const curated = findVaultByAddress(p.vault.address);
          return {
            version: p.version ?? 'v2',
            vault: {
              address: p.vault.address,
              name: p.vault.name || curated?.name,
              symbol: p.vault.symbol,
              vaultSymbol: curated?.vaultSymbol ?? p.vault.vaultSymbol,
              strategy: (curated?.strategy ?? p.vault.strategy) as VaultStrategy | undefined,
              isCurated: !!curated,
              state: { sharePriceUsd: 0, totalAssetsUsd: 0, totalSupply: '0' },
            },
            shares: p.shares,
            assets: p.assets,
            assetsUsd: p.assetsUsd,
            assetDecimals: p.assetDecimals,
            pnl: p.pnl,
            pnlUsd: p.pnlUsd,
            pnlRaw: p.pnlRaw,
          };
        }
      );

      const onChain = await onChainPromise;
      if (!isCurrent()) return 'aborted';
      const mergedPositions = mergeOnChainBalances(positions, onChain);
      const totalValueUsd = mergedPositions.reduce(
        (sum, position) => sum + (position.assetsUsd ?? 0),
        0
      );

      setMorphoHoldings({
        totalValueUsd,
        positions: mergedPositions,
        isLoading: false,
        error: null,
        resolvedAddress: requestedAddress,
      });

      logger.info('Morpho vault positions fetched from API', {
        positionCount: positions.length,
        totalValueUsd: totalValueUsd.toFixed(2),
        timestamp: new Date().toISOString(),
      });
      return 'ok';
    } catch (err) {
      if (!isCurrent()) return 'aborted';
      logger.error('Failed to fetch vault positions', err instanceof Error ? err : new Error(String(err)), {
        address: requestedAddress,
      });
      const onChain = await onChainPromise;
      if (!isCurrent()) return 'aborted';
      setMorphoHoldings((prev) => ({
        ...prev,
        positions: mergeOnChainBalances(prev.positions, onChain),
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch vault positions',
        resolvedAddress: requestedAddress,
      }));
      return 'retryable';
    }
  }, [publicClient]);

  const performRefresh = useCallback(async (walletAddress?: string): Promise<void> => {
    if (!walletAddress) return;
    const fetchId = ++walletDataFetchIdRef.current;
    refreshStateRef.current = { address: walletAddress.toLowerCase(), at: 0, inFlight: true };

    let results;
    try {
      results = await Promise.all([
      refetchEthBalance?.() ?? Promise.resolve(),
      fetchAllTokenBalances(walletAddress),
      refreshPrices().catch(() => undefined),
      fetchVaultPositions(walletAddress),
      ]);
    } catch (error) {
      if (fetchId === walletDataFetchIdRef.current) {
        refreshStateRef.current = { ...refreshStateRef.current, inFlight: false };
      }
      throw error;
    }
    const [, tokenResult, , morphoStatus] = results;
    if (fetchId !== walletDataFetchIdRef.current) return;
    refreshStateRef.current = {
      address: walletAddress.toLowerCase(),
      at: morphoStatus === 'ok' ? Date.now() : 0,
      inFlight: false,
    };

    const { tokens, ok } = tokenResult;
    // A failed read keeps this wallet's last good list; another wallet's list is never kept.
    const owner = walletAddress.toLowerCase();
    setAssetTokenState((prev) =>
      ok || tokens.length > 0 || prev.address !== owner ? { address: owner, tokens } : prev
    );

    logger.debug('Token balances updated', { ok, tokenCount: tokens.length });

    if (morphoStatus === 'aborted') return;

    if (!ok) {
      logger.warn('Wallet token balances unavailable', { address: walletAddress });
    }
    if (morphoStatus === 'retryable') {
      throw new Error('Morpho positions temporarily unavailable');
    }
  }, [
    refreshPrices,
    fetchVaultPositions,
    fetchAllTokenBalances,
    refetchEthBalance,
  ]);

  useEffect(() => {
    if (stableIsConnected && stableAddress) {
      void performRefresh(stableAddress).catch((err) => {
        logger.error(
          'Wallet data refresh failed',
          err instanceof Error ? err : new Error(String(err)),
          { address: stableAddress }
        );
      });
    } else if (!stableIsConnected) {
      walletDataFetchIdRef.current += 1;
      morphoFetchIdRef.current += 1;
      lastMorphoAddressRef.current = null;
      queueMicrotask(() => {
        setMorphoHoldings((prev) => ({
          ...prev,
          totalValueUsd: 0,
          positions: [],
          isLoading: false,
          error: null,
          resolvedAddress: null,
        }));
        setAssetTokenState({ address: null, tokens: [] });
      });
    }
  }, [stableIsConnected, stableAddress, performRefresh]);

  // The asset list can grow after the first refresh (a retried read fills in a vault). Re-read
  // just the token balances then, so that token's balance and deposit MAX show up.
  const lastAssetsKeyRef = useRef(knownAssetsKey);
  useEffect(() => {
    if (lastAssetsKeyRef.current === knownAssetsKey) return;
    lastAssetsKeyRef.current = knownAssetsKey;
    if (!stableIsConnected || !stableAddress) return;
    const wallet = stableAddress;
    // A wallet switch or a full refresh started after this read supersedes it.
    const requestId = walletDataFetchIdRef.current;
    void fetchAllTokenBalances(wallet).then(({ tokens, ok }) => {
      if (!ok && tokens.length === 0) return;
      if (requestId !== walletDataFetchIdRef.current) return;
      setAssetTokenState((prev) =>
        prev.address === null || prev.address === wallet.toLowerCase()
          ? { address: wallet.toLowerCase(), tokens }
          : prev
      );
    });
  }, [knownAssetsKey, stableIsConnected, stableAddress, fetchAllTokenBalances]);

  const refreshBalances = useCallback(async () => {
    // Charts read position history through a short client cache; drop it so they see this refresh.
    clearPositionHistoryCache();
    try {
      await performRefresh(address);
      logger.info('Balance refresh completed', {
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(
        'Balance refresh failed',
        err instanceof Error ? err : new Error(String(err)),
        { address }
      );
    }
  }, [performRefresh, address]);

  const refreshBalancesIfStale = useCallback(
    async (maxAgeMs: number) => {
      if (!address) return;
      const state = refreshStateRef.current;
      if (state.address === address.toLowerCase()) {
        if (state.inFlight) return;
        if (state.at > 0 && Date.now() - state.at < maxAgeMs) return;
      }
      await refreshBalances();
    },
    [address, refreshBalances]
  );

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Refresh with retry logic (exponential backoff)
  const refreshBalancesWithRetry = useCallback(async (options?: { maxRetries?: number; retryDelay?: number }) => {
    const maxRetries = options?.maxRetries ?? 3;
    const baseRetryDelay = options?.retryDelay ?? 1000; // 1 second base delay

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await performRefresh(address);
        if (attempt > 0) {
          logger.info('Balance refresh succeeded after retry', {
            attempt: attempt + 1,
            maxRetries,
            timestamp: new Date().toISOString(),
          });
        }
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          const delay = baseRetryDelay * Math.pow(2, attempt); // Exponential backoff: 1s, 2s, 4s
          logger.warn('Balance refresh failed, retrying', {
            attempt: attempt + 1,
            maxRetries,
            delayMs: delay,
            error: lastError.message,
            timestamp: new Date().toISOString(),
          });
          await sleep(delay);
        } else {
          logger.error('Balance refresh failed after all retries', lastError, {
            maxRetries,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    throw lastError || new Error('Balance refresh failed');
  }, [performRefresh, address]);

  // One delayed refresh after tx — Morpho indexer often lags a few seconds; no polling loop.
  const refreshBalancesWithPolling = useCallback(async (options?: { followUpDelayMs?: number; onComplete?: () => void | Promise<void> }) => {
    const followUpDelayMs = options?.followUpDelayMs ?? POST_TX_BALANCE_REFRESH_DELAY_MS;

    // Post-transaction: Morpho may not have indexed it yet, so charts must not cache for a while.
    markPositionHistoryTransaction();
    await sleep(followUpDelayMs);

    try {
      await performRefresh(address);
      logger.info('Post-transaction follow-up balance refresh completed', {
        followUpDelayMs,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Post-transaction follow-up balance refresh failed', err, {
        followUpDelayMs,
        timestamp: new Date().toISOString(),
      });
      throw err;
    }

    await options?.onComplete?.();
  }, [performRefresh, address]);

  // USD values from Morpho prices by address (native ETH uses WETH).
  const ethUsdValue = ethBalance ? parseFloat(ethBalance.formatted) * (priceOf('ETH') ?? 0) : 0;

  const allTokenBalances: TokenBalance[] = [
    {
      address: 'ETH',
      symbol: 'ETH',
      decimals: 18,
      balance: ethBalance?.value || BigInt(0),
      formatted: ethBalance?.formatted || '0',
      usdValue: ethUsdValue,
    },
    ...(assetTokenState.address === address?.toLowerCase() ? assetTokenState.tokens : []).map((token) => ({
      ...token,
      usdValue: parseFloat(token.formatted) * (priceOf(token.address) ?? 0),
    })),
  ];

  // Registry rows read on chain carry no USD yet: price them from the vault asset's price.
  const morphoHoldings = useMemo<MorphoHoldings>(() => {
    let changed = false;
    const positions = rawMorphoHoldings.positions.map((position) => {
      if (position.assetsUsd !== undefined) return position;
      changed = true;
      const decimals =
        position.assetDecimals ??
        assetForVault(position.vault.address)?.decimals ??
        getAssetDecimalsForSymbol(position.vault.symbol);
      let assetsDecimal = 0;
      try {
        assetsDecimal = rawAmountToDecimal(BigInt(position.assets ?? '0'), decimals);
      } catch {
        assetsDecimal = 0;
      }
      return { ...position, assetsUsd: assetsDecimal * (priceForVault(position.vault.address) ?? 0) };
    });
    if (!changed) return rawMorphoHoldings;
    return {
      ...rawMorphoHoldings,
      positions,
      totalValueUsd: positions.reduce((sum, position) => sum + (position.assetsUsd ?? 0), 0),
    };
  }, [rawMorphoHoldings, priceForVault, assetForVault]);

  // Remove duplicates, skip Morpho vault share tokens (already in Vaults USD),
  // and drop impostor-priced dust from the liquid total.
  const vaultShareAddresses = new Set(
    morphoHoldings.positions.map((position) => position.vault.address.toLowerCase())
  );
  const allValidTokenBalances = allTokenBalances
    .filter((token, index, self) =>
      token.balance > BigInt(0) &&
      !isVaultShareTokenAddress(token.address, vaultShareAddresses) &&
      index === self.findIndex(t => t.address.toLowerCase() === token.address.toLowerCase())
    );

  // Calculate liquid assets from ALL token balances (including dust tokens for accurate total)
  const liquidUsdValue = allValidTokenBalances.reduce((sum, token) => sum + token.usdValue, 0);

  // Show all tokens with non-zero balances (removed $1 filter to show small balances like 0.00000005 BTC)
  const tokenBalances = allValidTokenBalances
    .sort((a, b) => b.usdValue - a.usdValue);
  
  // Calculate total value (liquid + Morpho vaults)
  const totalUsdValue = liquidUsdValue + morphoHoldings.totalValueUsd;

  const value = useMemo<WalletContextType>(
    () => ({
      ethBalance: ethBalance?.formatted || '0',
      ethUsdValue: formatCurrency(ethUsdValue),
      totalUsdValue: formatCurrency(totalUsdValue),
      liquidUsdValue: formatCurrency(liquidUsdValue),
      morphoUsdValue: formatCurrency(morphoHoldings.totalValueUsd),
      tokenBalances,
      morphoHoldings,
      loading: morphoHoldings.isLoading,
      error: morphoHoldings.error,
      refreshBalances,
      refreshBalancesIfStale,
      refreshBalancesWithRetry,
      refreshBalancesWithPolling,
    }),
    [
      ethBalance?.formatted,
      ethUsdValue,
      totalUsdValue,
      liquidUsdValue,
      morphoHoldings,
      tokenBalances,
      refreshBalances,
      refreshBalancesIfStale,
      refreshBalancesWithRetry,
      refreshBalancesWithPolling,
    ]
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
