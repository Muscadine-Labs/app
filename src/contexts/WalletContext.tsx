'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useBalance, useReadContract } from 'wagmi';
import type { AlchemyTokenBalancesResponse, AlchemyTokenMetadataResponse, AlchemyTokenBalance } from '@/types/api';
import { formatCurrency } from '@/lib/formatter';
import { logger } from '@/lib/logger';
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
  refreshBalancesWithPolling: (options?: { followUpDelayMs?: number; onComplete?: () => void }) => Promise<void>;
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
  const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.usdc }
  });

  const { data: cbbtcBalance, refetch: refetchCbbtcBalance } = useReadContract({
    address: TOKEN_ADDRESSES.cbBTC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.cbbtc }
  });

  const { data: wethBalance, refetch: refetchWethBalance } = useReadContract({
    address: TOKEN_ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.weth }
  });

  const { data: cbethBalance, refetch: refetchCbethBalance } = useReadContract({
    address: TOKEN_ADDRESSES.cbETH,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && needsWagmiFallback.cbeth }
  });

  const { data: wstethBalance, refetch: refetchWstethBalance } = useReadContract({
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
  const fetchTokenPrices = useCallback(async (symbols: string[]) => {
    try {
      const symbolsParam = symbols.join(',');
      const response = await fetch(`/api/prices?symbols=${symbolsParam}`);
      const data = await response.json();
      return data;
    } catch {
      return {};
    }
  }, []);

  // Fetch all token balances using Alchemy API (more reliable than individual contract calls)
  const fetchAllTokenBalances = useCallback(async (): Promise<TokenBalance[]> => {
    if (!address) return [];

    const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyApiKey) {
      return [];
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
            params: [address, 'erc20'],
          }),
        }
      );

      const data = await response.json() as AlchemyTokenBalancesResponse;
      
      if (data.error) {
        return [];
      }

      const tokenAddresses = data.result?.tokenBalances || [];
      
      // Filter tokens with non-zero balance and separate into known/unknown
      const tokensWithBalance = tokenAddresses.filter((token: AlchemyTokenBalance) => {
        const balance = BigInt(token.tokenBalance || '0');
        return balance > BigInt(0); // Only process tokens with non-zero balance
      });

      // Separate tokens into known (use cached metadata) and unknown (fetch metadata)
      const knownTokens: Array<{ token: AlchemyTokenBalance; metadata: { decimals: number; symbol: string } }> = [];
      const unknownTokens: AlchemyTokenBalance[] = [];

      tokensWithBalance.forEach((token: AlchemyTokenBalance) => {
        const addressLower = token.contractAddress.toLowerCase();
        
        // Check if it's a known token
        if (KNOWN_TOKEN_METADATA[addressLower]) {
          knownTokens.push({
            token,
            metadata: KNOWN_TOKEN_METADATA[addressLower],
          });
          return;
        }

        // Check cache
        const cached = tokenMetadataCache.get(addressLower);
        if (cached && Date.now() - cached.timestamp < METADATA_CACHE_DURATION) {
          knownTokens.push({
            token,
            metadata: cached,
          });
          return;
        }

        // Need to fetch metadata
        unknownTokens.push(token);
      });

      // Process known tokens immediately (no API calls needed)
      const knownTokenBalances = knownTokens.map(({ token, metadata }) => {
        const balance = BigInt(token.tokenBalance || '0');
        const decimals = metadata.decimals;
        const symbol = metadata.symbol;
        const formatted = (Number(balance) / Math.pow(10, decimals)).toString();

        return {
          address: token.contractAddress,
          symbol,
          decimals,
          balance,
          formatted,
          usdValue: 0, // Will be calculated later with prices
        };
      });

      // Fetch metadata for unknown tokens only (dramatically reduces RPC calls)
      const tokenMetadataPromises = unknownTokens.map(async (token: AlchemyTokenBalance) => {
        try {
          const addressLower = token.contractAddress.toLowerCase();
          
          // Check cache again (in case another request populated it)
          const cached = tokenMetadataCache.get(addressLower);
          if (cached && Date.now() - cached.timestamp < METADATA_CACHE_DURATION) {
            const balance = BigInt(token.tokenBalance || '0');
            const decimals = cached.decimals;
            const symbol = cached.symbol;
            const formatted = (Number(balance) / Math.pow(10, decimals)).toString();

            return {
              address: token.contractAddress,
              symbol,
              decimals,
              balance,
              formatted,
              usdValue: 0,
            };
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

          const balance = BigInt(token.tokenBalance || '0');
          const decimals = metadataData.result.decimals || 18;
          let symbol = metadataData.result.symbol || 'UNKNOWN';
          const formatted = (Number(balance) / Math.pow(10, decimals)).toString();

          // Normalize cbBTC to ensure consistent symbol
          if (addressLower === TOKEN_ADDRESSES_LOWER.cbBTC) {
            symbol = 'cbBTC'; // Always use cbBTC (not CBTC or BTC)
          }

          // Cache the metadata to avoid future API calls
          tokenMetadataCache.set(addressLower, {
            decimals,
            symbol,
            name: metadataData.result.name,
            timestamp: Date.now(),
          });

          return {
            address: token.contractAddress,
            symbol,
            decimals,
            balance,
            formatted,
            usdValue: 0, // Will be calculated later with prices
          };
        } catch {
          return null;
        }
      });

      // Combine known tokens (no API calls) with fetched tokens
      const metadataResults = await Promise.all(tokenMetadataPromises);
      const fetchedTokens = metadataResults.filter((result): result is TokenBalance => result !== null);
      
      // Return combined results (known tokens + fetched tokens)
      return [...knownTokenBalances, ...fetchedTokens];
    } catch {
      return [];
    }
  }, [address]);

  // Fetch all Morpho vault positions from the API (v1 + v2, curated + external).
  const fetchVaultPositions = useCallback(async (): Promise<void> => {
    if (!address) {
      setMorphoHoldings(prev => ({
        ...prev,
        totalValueUsd: 0,
        positions: [],
        isLoading: false,
      }));
      return;
    }

    setMorphoHoldings(prev => ({ ...prev, isLoading: true, error: null }));

    const url = `/api/user/morpho-positions?address=${encodeURIComponent(address)}&chainId=8453`;
    const maxAttempts = 3;
    const retryDelayMs = 750;

    try {
      let morphoResponse: Response | null = null;
      let lastFetchError: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          morphoResponse = await fetch(url, { cache: 'no-store' });
          break;
        } catch (err) {
          lastFetchError = err;
          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          }
        }
      }

      if (!morphoResponse) {
        throw lastFetchError instanceof Error
          ? lastFetchError
          : new Error('Failed to fetch vault positions');
      }

      if (!morphoResponse.ok) {
        throw new Error(`Morpho positions API returned ${morphoResponse.status}`);
      }

      const morphoData = await morphoResponse.json();
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
    } catch (err) {
      logger.error('Failed to fetch vault positions', err instanceof Error ? err : new Error(String(err)), {
        address,
      });
      setMorphoHoldings(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch vault positions',
      }));
    }
  }, [address]);

  // Stable wallet state management - only clear data on actual disconnect
  useEffect(() => {
    if (stableIsConnected && stableAddress) {
      // Only fetch when actually connected with an address
      const fetchAllData = async () => {
        // Fetch all token balances from Alchemy first (primary source)
        const alchemyBalances = await fetchAllTokenBalances();
        setAlchemyTokenBalances(alchemyBalances);

        // Check if Alchemy returned key tokens - enable wagmi fallback only if missing
        const hasUsdc = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.USDC);
        const hasCbbtc = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbBTC);
        const hasWeth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH);
        const hasCbeth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbETH);
        const hasWsteth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.wstETH);
        
        setNeedsWagmiFallback({
          usdc: !hasUsdc,
          cbbtc: !hasCbbtc,
          weth: !hasWeth,
          cbeth: !hasCbeth,
          wsteth: !hasWsteth,
        });

        // Get unique symbols for price fetching
        const symbols = new Set<string>(['ETH', 'USDC', 'CBBTC', 'CBETH', 'WSTETH']);
        alchemyBalances.forEach(token => {
          const symbol = token.symbol.toUpperCase();
          if (symbol === 'WETH') {
            symbols.add('WETH');
          } else if (symbol !== 'USDC' && symbol !== 'CBBTC') {
            symbols.add(symbol);
          }
        });

        // Fetch prices for all tokens
        const prices = await fetchTokenPrices(Array.from(symbols));
        setTokenPrices({
          eth: prices.eth || 0,
          usdc: prices.usdc || 1, // USDC is pegged to $1
          cbbtc: prices.cbbtc || 0, // cbBTC price only
          weth: prices.weth || prices.eth || 0, // WETH uses ETH price
          ...Object.fromEntries(
            Object.entries(prices).map(([key, value]) => [key.toLowerCase(), value])
          ),
        });
        // Fetch vault positions using RPC (balanceOf + convertToAssets)
        await fetchVaultPositions();
      };
      
      fetchAllData();
    } else if (!stableIsConnected) {
      // Only clear data when explicitly disconnected (not during auth flows)
      setMorphoHoldings(prev => ({ 
        ...prev, 
        totalValueUsd: 0, 
        positions: [],
        isLoading: false 
      }));
      setTokenPrices({});
      setAlchemyTokenBalances([]);
    }
    // Don't include fetchVaultPositions and fetchTokenPrices in deps to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableIsConnected, stableAddress, fetchAllTokenBalances]);

  const refreshBalances = useCallback(async () => {
    // Refetch ETH balance (always needed)
    if (address && refetchEthBalance) {
      await refetchEthBalance();
    }

    // Fetch all token balances from Alchemy (primary source)
    const alchemyBalances = await fetchAllTokenBalances();
    setAlchemyTokenBalances(alchemyBalances);

    // Check if Alchemy returned key tokens - enable wagmi fallback only if missing
    const hasUsdc = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.USDC);
    const hasCbbtc = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbBTC);
    const hasWeth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH);
    const hasCbeth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbETH);
    const hasWsteth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.wstETH);
    
    setNeedsWagmiFallback({
      usdc: !hasUsdc,
      cbbtc: !hasCbbtc,
      weth: !hasWeth,
      cbeth: !hasCbeth,
      wsteth: !hasWsteth,
    });

    // Only refetch wagmi hooks if fallback is needed
    const refetchPromises = [];
    if (address) {
      if (!hasUsdc && refetchUsdcBalance) refetchPromises.push(refetchUsdcBalance());
      if (!hasCbbtc && refetchCbbtcBalance) refetchPromises.push(refetchCbbtcBalance());
      if (!hasWeth && refetchWethBalance) refetchPromises.push(refetchWethBalance());
      if (!hasCbeth && refetchCbethBalance) refetchPromises.push(refetchCbethBalance());
      if (!hasWsteth && refetchWstethBalance) refetchPromises.push(refetchWstethBalance());
    }
    await Promise.all(refetchPromises);

    const symbols = new Set<string>(['ETH', 'USDC', 'CBBTC', 'CBETH', 'WSTETH']);
    alchemyBalances.forEach(token => {
      const symbol = token.symbol.toUpperCase();
      if (symbol === 'WETH') {
        symbols.add('WETH');
      } else if (symbol === 'CBETH') {
        symbols.add('CBETH');
      } else if (symbol === 'WSTETH') {
        symbols.add('WSTETH');
      } else if (symbol !== 'USDC' && symbol !== 'CBBTC') {
        symbols.add(symbol);
      }
    });

    const prices = await fetchTokenPrices(Array.from(symbols));
    setTokenPrices({
      eth: prices.eth || 0,
      usdc: prices.usdc || 1,
      cbbtc: prices.cbbtc || 0, // cbBTC price only
      weth: prices.weth || prices.eth || 0,
      ...Object.fromEntries(
        Object.entries(prices).map(([key, value]) => [key.toLowerCase(), value])
      ),
    });
    
    // Log USDC balance specifically for debugging
    const usdcBalance = alchemyBalances.find(t => t.symbol.toUpperCase() === 'USDC');
    logger.debug('Token balances and prices updated', {
      alchemyBalanceCount: alchemyBalances.length,
      tokenCount: symbols.size,
      usdcBalance: usdcBalance ? {
        symbol: usdcBalance.symbol,
        balance: usdcBalance.balance.toString(),
        formatted: usdcBalance.formatted,
        decimals: usdcBalance.decimals,
      } : 'not found',
      allTokens: alchemyBalances.map(t => ({
        symbol: t.symbol,
        formatted: t.formatted,
        balance: t.balance.toString(),
      })),
      timestamp: new Date().toISOString(),
    });
    
    // Fetch vault positions using RPC (balanceOf + convertToAssets)
    await fetchVaultPositions();
    
    logger.info('Balance refresh completed', {
      timestamp: new Date().toISOString(),
      note: 'Check detailed logs above for fetched values - state updates asynchronously via React',
    });
  }, [fetchTokenPrices, fetchVaultPositions, fetchAllTokenBalances, refetchEthBalance, refetchUsdcBalance, refetchCbbtcBalance, refetchWethBalance, refetchCbethBalance, refetchWstethBalance, address]);

  // Helper function to sleep/delay
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Core refresh logic (extracted for reuse)
  const performRefresh = useCallback(async (): Promise<void> => {
    // Refetch ETH balance (always needed)
    if (address && refetchEthBalance) {
      await refetchEthBalance();
    }

    // Fetch all token balances from Alchemy (primary source)
    const alchemyBalances = await fetchAllTokenBalances();
    setAlchemyTokenBalances(alchemyBalances);

    // Check if Alchemy returned key tokens - enable wagmi fallback only if missing
    const hasUsdc = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.USDC);
    const hasCbbtc = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbBTC);
    const hasWeth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH);
    const hasCbeth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbETH);
    const hasWsteth = alchemyBalances.some(t => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.wstETH);
    
    setNeedsWagmiFallback({
      usdc: !hasUsdc,
      cbbtc: !hasCbbtc,
      weth: !hasWeth,
      cbeth: !hasCbeth,
      wsteth: !hasWsteth,
    });

    // Only refetch wagmi hooks if fallback is needed
    const refetchPromises = [];
    if (address) {
      if (!hasUsdc && refetchUsdcBalance) refetchPromises.push(refetchUsdcBalance());
      if (!hasCbbtc && refetchCbbtcBalance) refetchPromises.push(refetchCbbtcBalance());
      if (!hasWeth && refetchWethBalance) refetchPromises.push(refetchWethBalance());
      if (!hasCbeth && refetchCbethBalance) refetchPromises.push(refetchCbethBalance());
      if (!hasWsteth && refetchWstethBalance) refetchPromises.push(refetchWstethBalance());
    }
    await Promise.all(refetchPromises);

    const symbols = new Set<string>(['ETH', 'USDC', 'CBBTC', 'CBETH', 'WSTETH']);
    alchemyBalances.forEach(token => {
      const symbol = token.symbol.toUpperCase();
      if (symbol === 'WETH') {
        symbols.add('WETH');
      } else if (symbol === 'CBETH') {
        symbols.add('CBETH');
      } else if (symbol === 'WSTETH') {
        symbols.add('WSTETH');
      } else if (symbol !== 'USDC' && symbol !== 'CBBTC') {
        symbols.add(symbol);
      }
    });

    const prices = await fetchTokenPrices(Array.from(symbols));
    setTokenPrices({
      eth: prices.eth || 0,
      usdc: prices.usdc || 1,
      cbbtc: prices.cbbtc || 0, // cbBTC price only
      weth: prices.weth || prices.eth || 0,
      ...Object.fromEntries(
        Object.entries(prices).map(([key, value]) => [key.toLowerCase(), value])
      ),
    });

    await fetchVaultPositions();
  }, [fetchTokenPrices, fetchVaultPositions, fetchAllTokenBalances, refetchEthBalance, refetchUsdcBalance, refetchCbbtcBalance, refetchWethBalance, refetchCbethBalance, refetchWstethBalance, address]);

  // Refresh with retry logic (exponential backoff)
  const refreshBalancesWithRetry = useCallback(async (options?: { maxRetries?: number; retryDelay?: number }) => {
    const maxRetries = options?.maxRetries ?? 3;
    const baseRetryDelay = options?.retryDelay ?? 1000; // 1 second base delay

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await performRefresh();
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
  }, [performRefresh]);

  // One delayed refresh after tx — Morpho indexer often lags ~6–8s; no polling loop.
  const refreshBalancesWithPolling = useCallback(async (options?: { followUpDelayMs?: number; onComplete?: () => void }) => {
    const followUpDelayMs = options?.followUpDelayMs ?? 8000;

    await sleep(followUpDelayMs);

    try {
      await performRefresh();
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
    }

    options?.onComplete?.();
  }, [performRefresh]);

  // Calculate balances and USD values
  const ethFormatted = ethBalance ? parseFloat(ethBalance.formatted) : 0;
  const ethUsdValue = ethFormatted * (tokenPrices.eth || 0);
  
  // Calculate token balances with proper decimals
  const usdcDecimalsValue = usdcDecimals || 6;
  const usdcFormatted = usdcBalance ? Number(usdcBalance) / Math.pow(10, usdcDecimalsValue) : 0;
  const usdcUsdValue = usdcFormatted * (tokenPrices.usdc || 1);
  
  const cbbtcDecimalsValue = cbbtcDecimals || 8;
  const cbbtcFormatted = cbbtcBalance ? Number(cbbtcBalance) / Math.pow(10, cbbtcDecimalsValue) : 0;
  const cbbtcUsdValue = cbbtcFormatted * (tokenPrices.cbbtc || 0);
  
  const wethDecimalsValue = wethDecimals || 18;
  const wethFormatted = wethBalance ? Number(wethBalance) / Math.pow(10, wethDecimalsValue) : 0;
  const wethUsdValue = wethFormatted * (tokenPrices.weth || tokenPrices.eth || 0);
  
  const cbethDecimalsValue = cbethDecimals || 18;
  const cbethFormatted = cbethBalance ? Number(cbethBalance) / Math.pow(10, cbethDecimalsValue) : 0;
  const cbethUsdValue = cbethFormatted * (tokenPrices.cbeth || tokenPrices.eth || 0);
  
  const wstethDecimalsValue = wstethDecimals || 18;
  const wstethFormatted = wstethBalance ? Number(wstethBalance) / Math.pow(10, wstethDecimalsValue) : 0;
  const wstethUsdValue = wstethFormatted * (tokenPrices.wsteth || tokenPrices.eth || 0);

  // Build token balances array - combine ETH, manually fetched tokens, and Alchemy tokens
  // Calculate USD values for Alchemy tokens
  const alchemyBalancesWithPrices = alchemyTokenBalances.map(token => {
    const addressLower = token.address.toLowerCase();
    let price = 0;
    
    // Use address-based matching for major tokens (same as detection)
    if (addressLower === TOKEN_ADDRESSES_LOWER.cbBTC) {
      price = tokenPrices.cbbtc || 0;
    } else if (addressLower === TOKEN_ADDRESSES_LOWER.USDC) {
      price = tokenPrices.usdc || 1;
    } else if (addressLower === TOKEN_ADDRESSES_LOWER.WETH) {
      price = tokenPrices.weth || tokenPrices.eth || 0;
    } else if (addressLower === TOKEN_ADDRESSES_LOWER.cbETH) {
      price = tokenPrices.cbeth || tokenPrices.eth || 0;
    } else if (addressLower === TOKEN_ADDRESSES_LOWER.wstETH) {
      price = tokenPrices.wsteth || tokenPrices.eth || 0;
    } else {
      // Try to find price by symbol (case insensitive)
      const symbolUpper = token.symbol.toUpperCase();
      price = tokenPrices[symbolUpper.toLowerCase()] || tokenPrices[token.symbol.toLowerCase()] || 0;
    }
    
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

  // Remove duplicates and filter to only non-zero balances (for total calculation)
  const allValidTokenBalances = allTokenBalances
    .filter((token, index, self) => 
      token.balance > BigInt(0) && 
      index === self.findIndex(t => t.address.toLowerCase() === token.address.toLowerCase())
    );

  // Calculate liquid assets from ALL token balances (including dust tokens for accurate total)
  const liquidUsdValue = allValidTokenBalances.reduce((sum, token) => sum + token.usdValue, 0);

  // Show all tokens with non-zero balances (removed $1 filter to show small balances like 0.00000005 BTC)
  const tokenBalances = allValidTokenBalances
    .sort((a, b) => b.usdValue - a.usdValue);
  
  // Calculate total value (liquid + Morpho vaults)
  const totalUsdValue = liquidUsdValue + morphoHoldings.totalValueUsd;

  const value: WalletContextType = {
    ethBalance: ethBalance?.formatted || '0',
    ethUsdValue: formatCurrency(ethUsdValue),
    totalUsdValue: formatCurrency(totalUsdValue),
    liquidUsdValue: formatCurrency(liquidUsdValue),
    morphoUsdValue: formatCurrency(morphoHoldings.totalValueUsd),
    tokenBalances, // Now includes all major tokens with non-zero balances
    morphoHoldings,
    loading: morphoHoldings.isLoading,
    error: morphoHoldings.error,
    refreshBalances,
    refreshBalancesWithRetry,
    refreshBalancesWithPolling,
  };

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
