'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useBalance, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import type { AlchemyTokenBalancesResponse, AlchemyTokenMetadataResponse, AlchemyTokenBalance } from '@/types/api';
import { formatCurrency } from '@/lib/formatter';
import { logger } from '@/lib/logger';
import { POST_TX_BALANCE_REFRESH_DELAY_MS } from '@/lib/constants';
import { findVaultByAddress } from '@/lib/vault-utils';
import type { VaultStrategy } from '@/lib/vaults';

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
  refreshBalancesWithRetry: (options?: { maxRetries?: number; retryDelay?: number }) => Promise<void>;
  refreshBalancesWithPolling: (options?: { followUpDelayMs?: number; onComplete?: () => void | Promise<void> }) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Major token addresses on Base
export const TOKEN_ADDRESSES = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Circle USD Coin on Base
  cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // Coinbase Wrapped BTC on Base
  WETH: '0x4200000000000000000000000000000000000006', // Wrapped ETH on Base
  cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', // Coinbase Wrapped ETH on Base
  wstETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', // Wrapped Lido staked ETH on Base
} as const;

// Pre-compute lowercased addresses for efficient comparisons (avoid repeated .toLowerCase() calls)
export const TOKEN_ADDRESSES_LOWER = {
  USDC: TOKEN_ADDRESSES.USDC.toLowerCase(),
  cbBTC: TOKEN_ADDRESSES.cbBTC.toLowerCase(),
  WETH: TOKEN_ADDRESSES.WETH.toLowerCase(),
  cbETH: TOKEN_ADDRESSES.cbETH.toLowerCase(),
  wstETH: TOKEN_ADDRESSES.wstETH.toLowerCase(),
} as const;

/** Symbols whose USD price must only apply to the canonical Base address. */
const MAJOR_SYMBOL_PRICES = new Set([
  'ETH',
  'WETH',
  'USDC',
  'USDT',
  'DAI',
  'CBBTC',
  'BTC',
  'CBETH',
  'WSTETH',
  'STETH',
  'WBTC',
]);

function resolveTokenUsdPrice(
  token: { address: string; symbol: string },
  tokenPrices: Record<string, number>
): number {
  if (token.address === 'ETH') return tokenPrices.eth || 0;
  const addressLower = token.address.toLowerCase();
  if (addressLower === TOKEN_ADDRESSES_LOWER.cbBTC) return tokenPrices.cbbtc || 0;
  if (addressLower === TOKEN_ADDRESSES_LOWER.USDC) return tokenPrices.usdc || 1;
  if (addressLower === TOKEN_ADDRESSES_LOWER.WETH) {
    return tokenPrices.weth || tokenPrices.eth || 0;
  }
  if (addressLower === TOKEN_ADDRESSES_LOWER.cbETH) return tokenPrices.cbeth || 0;
  if (addressLower === TOKEN_ADDRESSES_LOWER.wstETH) return tokenPrices.wsteth || 0;

  const symbol = token.symbol.trim().toUpperCase();
  if (symbol === 'STETH') return tokenPrices.steth || 0;
  if (MAJOR_SYMBOL_PRICES.has(symbol)) return 0;
  const mapped = tokenPrices[symbol.toLowerCase()];
  return typeof mapped === 'number' && Number.isFinite(mapped) ? mapped : 0;
}

function isVaultShareTokenAddress(address: string, positionAddresses: Set<string>): boolean {
  if (address === 'ETH') return false;
  if (findVaultByAddress(address)) return true;
  return positionAddresses.has(address.toLowerCase());
}

// Token metadata cache - persists across component remounts
// Token metadata rarely changes, so we cache it to avoid repeated RPC calls
const tokenMetadataCache = new Map<string, { decimals: number; symbol: string; name?: string; timestamp: number }>();
const METADATA_CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache duration

// Known token metadata - no need to fetch from API (most common tokens)
const KNOWN_TOKEN_METADATA: Record<string, { decimals: number; symbol: string; name: string }> = {
  [TOKEN_ADDRESSES.USDC.toLowerCase()]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' },
  [TOKEN_ADDRESSES.cbBTC.toLowerCase()]: { decimals: 8, symbol: 'cbBTC', name: 'Coinbase Wrapped BTC' },
  [TOKEN_ADDRESSES.WETH.toLowerCase()]: { decimals: 18, symbol: 'WETH', name: 'Wrapped Ether' },
  [TOKEN_ADDRESSES.cbETH.toLowerCase()]: { decimals: 18, symbol: 'cbETH', name: 'Coinbase Wrapped ETH' },
  [TOKEN_ADDRESSES.wstETH.toLowerCase()]: { decimals: 18, symbol: 'wstETH', name: 'Wrapped Lido Staked ETH' },
};

// ERC20 ABI for balanceOf, decimals, and symbol
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const WAGMI_FALLBACK_NONE = {
  usdc: false,
  cbbtc: false,
  weth: false,
  cbeth: false,
  wsteth: false,
};

const WAGMI_FALLBACK_ALL = {
  usdc: true,
  cbbtc: true,
  weth: true,
  cbeth: true,
  wsteth: true,
};

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

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [alchemyTokenBalances, setAlchemyTokenBalances] = useState<TokenBalance[]>([]);
  const [morphoHoldings, setMorphoHoldings] = useState<MorphoHoldings>({
    totalValueUsd: 0,
    positions: [],
    isLoading: false,
    error: null,
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

  // Wagmi contract reads - used as fallback only when Alchemy doesn't return token data
  // Disabled by default to avoid redundant RPC calls (Alchemy is primary source)
  const [needsWagmiFallback, setNeedsWagmiFallback] = useState<{
    usdc: boolean;
    cbbtc: boolean;
    weth: boolean;
    cbeth: boolean;
    wsteth: boolean;
  }>({ usdc: false, cbbtc: false, weth: false, cbeth: false, wsteth: false });

  // Get token balances for major tokens (fallback only)
  const { data: usdcBalance } = useReadContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.usdc }
  });

  const { data: cbbtcBalance } = useReadContract({
    address: TOKEN_ADDRESSES.cbBTC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.cbbtc }
  });

  const { data: wethBalance } = useReadContract({
    address: TOKEN_ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.weth }
  });

  const { data: cbethBalance } = useReadContract({
    address: TOKEN_ADDRESSES.cbETH,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.cbeth }
  });

  const { data: wstethBalance } = useReadContract({
    address: TOKEN_ADDRESSES.wstETH,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.wsteth }
  });

  // Get token decimals (fallback only - Alchemy provides decimals)
  const { data: usdcDecimals } = useReadContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!address && needsWagmiFallback.usdc }
  });

  const { data: cbbtcDecimals } = useReadContract({
    address: TOKEN_ADDRESSES.cbBTC,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!address && needsWagmiFallback.cbbtc }
  });

  const { data: wethDecimals } = useReadContract({
    address: TOKEN_ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!address && needsWagmiFallback.weth }
  });

  const { data: cbethDecimals } = useReadContract({
    address: TOKEN_ADDRESSES.cbETH,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!address && needsWagmiFallback.cbeth }
  });

  const { data: wstethDecimals } = useReadContract({
    address: TOKEN_ADDRESSES.wstETH,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!address && needsWagmiFallback.wsteth }
  });

  // Fetch token prices dynamically
  const fetchTokenPrices = useCallback(async (symbols: string[]): Promise<Record<string, number>> => {
    try {
      const symbolsParam = symbols.join(',');
      const response = await fetch(`/api/prices?symbols=${symbolsParam}`);
      if (!response.ok) {
        return {};
      }
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {};
      }

      const prices: Record<string, number> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          prices[key] = value;
        }
      }
      return prices;
    } catch {
      return {};
    }
  }, []);

  // Fetch all token balances using Alchemy API (more reliable than individual contract calls)
  const fetchAllTokenBalances = useCallback(async (
    walletAddress: string | undefined
  ): Promise<{ tokens: TokenBalance[]; ok: boolean }> => {
    if (!walletAddress) return { tokens: [], ok: true };

    const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyApiKey) {
      return { tokens: [], ok: false };
    }

    try {
      const response = await fetch(
        `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'alchemy_getTokenBalances',
            params: [walletAddress, 'erc20'],
          }),
        }
      );

      if (!response.ok) {
        return { tokens: [], ok: false };
      }

      const data = await response.json() as AlchemyTokenBalancesResponse;

      if (data.error) {
        return { tokens: [], ok: false };
      }

      const tokenAddresses = data.result?.tokenBalances || [];

      const tokensWithBalance = tokenAddresses.filter((token: AlchemyTokenBalance) => {
        try {
          return BigInt(token.tokenBalance || '0') > BigInt(0);
        } catch {
          return false;
        }
      });

      const knownTokens: Array<{ token: AlchemyTokenBalance; metadata: { decimals: number; symbol: string } }> = [];
      const unknownTokens: AlchemyTokenBalance[] = [];

      tokensWithBalance.forEach((token: AlchemyTokenBalance) => {
        const addressLower = token.contractAddress.toLowerCase();

        if (KNOWN_TOKEN_METADATA[addressLower]) {
          knownTokens.push({
            token,
            metadata: KNOWN_TOKEN_METADATA[addressLower],
          });
          return;
        }

        const cached = tokenMetadataCache.get(addressLower);
        if (cached && Date.now() - cached.timestamp < METADATA_CACHE_DURATION) {
          knownTokens.push({
            token,
            metadata: cached,
          });
          return;
        }

        unknownTokens.push(token);
      });

      const knownTokenBalances = knownTokens
        .map(({ token, metadata }) =>
          toTokenBalance(token.contractAddress, token.tokenBalance, metadata.decimals, metadata.symbol)
        )
        .filter((result): result is TokenBalance => result !== null);

      const tokenMetadataPromises = unknownTokens.map(async (token: AlchemyTokenBalance) => {
        try {
          const addressLower = token.contractAddress.toLowerCase();

          const cached = tokenMetadataCache.get(addressLower);
          if (cached && Date.now() - cached.timestamp < METADATA_CACHE_DURATION) {
            return toTokenBalance(token.contractAddress, token.tokenBalance, cached.decimals, cached.symbol);
          }

          const metadataResponse = await fetch(
            `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'alchemy_getTokenMetadata',
                params: [token.contractAddress],
              }),
            }
          );

          const metadataData = await metadataResponse.json() as AlchemyTokenMetadataResponse;

          if (metadataData.error || !metadataData.result) {
            return null;
          }

          const decimals = metadataData.result.decimals || 18;
          let symbol = metadataData.result.symbol || 'UNKNOWN';
          if (addressLower === TOKEN_ADDRESSES_LOWER.cbBTC) {
            symbol = 'cbBTC';
          }

          tokenMetadataCache.set(addressLower, {
            decimals,
            symbol,
            name: metadataData.result.name,
            timestamp: Date.now(),
          });

          return toTokenBalance(token.contractAddress, token.tokenBalance, decimals, symbol);
        } catch {
          return null;
        }
      });

      const metadataResults = await Promise.all(tokenMetadataPromises);
      const fetchedTokens = metadataResults.filter((result): result is TokenBalance => result !== null);

      return { tokens: [...knownTokenBalances, ...fetchedTokens], ok: true };
    } catch {
      return { tokens: [], ok: false };
    }
  }, []);

  // Fetch all Morpho v2 vault positions from the API (curated + external).
  const morphoFetchIdRef = useRef(0);
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
      ...(addressChanged ? { positions: [], totalValueUsd: 0 } : {}),
    }));

    const url = `/api/user/morpho-positions?address=${encodeURIComponent(requestedAddress)}&chainId=8453&includeEmpty=true`;
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
        // Keep last successful snapshot for this wallet (already cleared on address change).
        setMorphoHoldings((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
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
              name: curated?.name ?? p.vault.name,
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

      const totalValueUsd = positions.reduce(
        (sum, position) => sum + (position.assetsUsd ?? 0),
        0
      );

      setMorphoHoldings({
        totalValueUsd,
        positions,
        isLoading: false,
        error: null,
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
      setMorphoHoldings((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch vault positions',
      }));
      return 'retryable';
    }
  }, []);

  const performRefresh = useCallback(async (walletAddress?: string): Promise<void> => {
    if (!walletAddress) return;
    const fetchId = ++walletDataFetchIdRef.current;

    if (refetchEthBalance) {
      await refetchEthBalance();
    }
    if (fetchId !== walletDataFetchIdRef.current) return;

    const { tokens, ok } = await fetchAllTokenBalances(walletAddress);
    if (fetchId !== walletDataFetchIdRef.current) return;

    setAlchemyTokenBalances(tokens);
    setNeedsWagmiFallback(ok ? { ...WAGMI_FALLBACK_NONE } : { ...WAGMI_FALLBACK_ALL });
    // When Alchemy fails, enabling the wagmi reads is enough — they fetch on the next render.
    // Refetching here is a no-op because `enabled` is still false on this tick.

    const symbols = new Set<string>(['ETH', 'USDC', 'CBBTC', 'CBETH', 'WSTETH', 'STETH', 'WETH']);

    const prices = await fetchTokenPrices(Array.from(symbols));
    if (fetchId !== walletDataFetchIdRef.current) return;

    setTokenPrices({
      eth: prices.eth || 0,
      usdc: prices.usdc || 1,
      cbbtc: prices.cbbtc || 0,
      weth: prices.weth || prices.eth || 0,
      ...Object.fromEntries(
        Object.entries(prices).map(([key, value]) => [key.toLowerCase(), value])
      ),
    });

    logger.debug('Token balances and prices updated', {
      alchemyOk: ok,
      alchemyBalanceCount: tokens.length,
      tokenCount: symbols.size,
    });

    const morphoStatus = await fetchVaultPositions(walletAddress);
    if (fetchId !== walletDataFetchIdRef.current || morphoStatus === 'aborted') return;

    if (!ok) {
      throw new Error('Failed to fetch token balances');
    }
    if (morphoStatus === 'retryable') {
      throw new Error('Morpho positions temporarily unavailable');
    }
  }, [
    fetchTokenPrices,
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
        }));
        setTokenPrices({});
        setAlchemyTokenBalances([]);
        setNeedsWagmiFallback({ ...WAGMI_FALLBACK_NONE });
      });
    }
  }, [stableIsConnected, stableAddress, performRefresh]);

  const refreshBalances = useCallback(async () => {
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

  // Calculate balances and USD values
  const ethFormatted = ethBalance ? parseFloat(ethBalance.formatted) : 0;
  const ethUsdValue = ethFormatted * (tokenPrices.eth || 0);
  
  // Calculate token balances with proper decimals
  const usdcDecimalsValue = usdcDecimals || 6;
  const usdcFormatted = usdcBalance ? formatUnits(usdcBalance, usdcDecimalsValue) : '0';
  const usdcUsdValue = parseFloat(usdcFormatted) * (tokenPrices.usdc || 1);
  
  const cbbtcDecimalsValue = cbbtcDecimals || 8;
  const cbbtcFormatted = cbbtcBalance ? formatUnits(cbbtcBalance, cbbtcDecimalsValue) : '0';
  const cbbtcUsdValue = parseFloat(cbbtcFormatted) * (tokenPrices.cbbtc || 0);
  
  const wethDecimalsValue = wethDecimals || 18;
  const wethFormatted = wethBalance ? formatUnits(wethBalance, wethDecimalsValue) : '0';
  const wethUsdValue = parseFloat(wethFormatted) * (tokenPrices.weth || tokenPrices.eth || 0);
  
  const cbethDecimalsValue = cbethDecimals || 18;
  const cbethFormatted = cbethBalance ? formatUnits(cbethBalance, cbethDecimalsValue) : '0';
  const cbethUsdValue = parseFloat(cbethFormatted) * (tokenPrices.cbeth || 0);
  
  const wstethDecimalsValue = wstethDecimals || 18;
  const wstethFormatted = wstethBalance ? formatUnits(wstethBalance, wstethDecimalsValue) : '0';
  const wstethUsdValue = parseFloat(wstethFormatted) * (tokenPrices.wsteth || 0);

  // Build token balances array - combine ETH, manually fetched tokens, and Alchemy tokens
  // Calculate USD values for Alchemy tokens
  const alchemyBalancesWithPrices = alchemyTokenBalances.map(token => {
    const price = resolveTokenUsdPrice(token, tokenPrices);
    const usdValue = parseFloat(token.formatted) * price;
    
    return {
      ...token,
      usdValue,
    };
  });

  // Combine all token balances - Alchemy is primary, wagmi is fallback only
  const allTokenBalances: TokenBalance[] = [
    // ETH (native)
    {
      address: 'ETH',
      symbol: 'ETH',
      decimals: 18,
      balance: ethBalance?.value || BigInt(0),
      formatted: ethBalance?.formatted || '0',
      usdValue: ethUsdValue,
    },
    // Alchemy tokens (primary source - includes USDC, cbBTC, WETH if available)
    ...alchemyBalancesWithPrices,
    // Wagmi fallback tokens (only if Alchemy didn't return them)
    ...(usdcBalance && usdcBalance > BigInt(0) && !alchemyBalancesWithPrices.find(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.USDC) ? [{
      address: TOKEN_ADDRESSES.USDC,
      symbol: 'USDC',
      decimals: usdcDecimalsValue,
      balance: usdcBalance,
      formatted: usdcFormatted.toString(),
      usdValue: usdcUsdValue,
    }] : []),
    ...(cbbtcBalance && cbbtcBalance > BigInt(0) && !alchemyBalancesWithPrices.find(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbBTC) ? [{
      address: TOKEN_ADDRESSES.cbBTC,
      symbol: 'cbBTC',
      decimals: cbbtcDecimalsValue,
      balance: cbbtcBalance,
      formatted: cbbtcFormatted.toString(),
      usdValue: cbbtcUsdValue,
    }] : []),
    ...(wethBalance && wethBalance > BigInt(0) && !alchemyBalancesWithPrices.find(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH) ? [{
      address: TOKEN_ADDRESSES.WETH,
      symbol: 'WETH',
      decimals: wethDecimalsValue,
      balance: wethBalance,
      formatted: wethFormatted.toString(),
      usdValue: wethUsdValue,
    }] : []),
    ...(cbethBalance && cbethBalance > BigInt(0) && !alchemyBalancesWithPrices.find(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbETH) ? [{
      address: TOKEN_ADDRESSES.cbETH,
      symbol: 'cbETH',
      decimals: cbethDecimalsValue,
      balance: cbethBalance,
      formatted: cbethFormatted.toString(),
      usdValue: cbethUsdValue,
    }] : []),
    ...(wstethBalance && wstethBalance > BigInt(0) && !alchemyBalancesWithPrices.find(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.wstETH) ? [{
      address: TOKEN_ADDRESSES.wstETH,
      symbol: 'wstETH',
      decimals: wstethDecimalsValue,
      balance: wstethBalance,
      formatted: wstethFormatted.toString(),
      usdValue: wstethUsdValue,
    }] : []),
  ];

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
