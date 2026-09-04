'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { formatUnits } from 'viem';
import { Vault, MorphoVaultData, VaultLiquidityBreakdown } from '@/types/vault';
import { getVaultVersion, findVaultByAddress, isCuratedVaultAddress } from '@/lib/vault-utils';
import { MORPHO_PRELOAD_BATCH_SIZE, MORPHO_FETCH_ERROR_COOLDOWN_MS, CLIENT_VAULT_DATA_CACHE_MS } from '../lib/constants';

interface VaultDataState {
  [vaultAddress: string]: {
    basic: Vault | null;
    loading: boolean;
    error: string | null;
    lastFetched: number;
    isStale?: boolean;
  };
}

interface VaultDataContextType {
  vaultData: VaultDataState;
  fetchVaultData: (
    address: string,
    chainId?: number,
    forceRefresh?: boolean
  ) => Promise<void>;
  getVaultData: (address: string) => MorphoVaultData | null;
  isLoading: (address: string) => boolean;
  hasError: (address: string) => boolean;
  getVaultError: (address: string) => string | null;
  isStaleData: (address: string) => boolean;
  preloadVaults: (vaults: Vault[]) => Promise<void>;
}

const VaultDataContext = createContext<VaultDataContextType | undefined>(undefined);

interface VaultDataProviderProps {
  children: ReactNode;
}

// Constants moved outside component to avoid unnecessary re-renders
const MAX_PENDING_REQUESTS = 50; // Maximum pending requests before cleanup

export function VaultDataProvider({ children }: VaultDataProviderProps) {
  const [vaultData, setVaultData] = useState<VaultDataState>({});
  
  // Request deduplication maps with cleanup mechanism
  const pendingRequests = React.useRef<Map<string, Promise<void>>>(new Map());
  
  // Ref to track current vaultData to avoid dependency issues
  const vaultDataRef = React.useRef<VaultDataState>(vaultData);
  
  const commitVaultData = React.useCallback((updater: React.SetStateAction<VaultDataState>) => {
    setVaultData((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      vaultDataRef.current = next;
      return next;
    });
  }, []);

  // Cleanup old pending requests periodically to prevent memory leaks
  React.useEffect(() => {
    const cleanup = setInterval(() => {
      if (pendingRequests.current.size > MAX_PENDING_REQUESTS) {
        // Remove oldest entries (FIFO - first in, first out)
        const entries = Array.from(pendingRequests.current.entries());
        const toRemove = entries.slice(0, entries.length - MAX_PENDING_REQUESTS);
        toRemove.forEach(([key]) => pendingRequests.current.delete(key));
      }
    }, 60000); // Run cleanup every minute

    return () => clearInterval(cleanup);
  }, []);

  const isDataStale = useCallback((timestamp: number) => {
    return Date.now() - timestamp > CLIENT_VAULT_DATA_CACHE_MS;
  }, []);

  // NEW: Fetch complete vault data in ONE API call
  const fetchCompleteVaultData = useCallback(async (
    address: string,
    chainId?: number,
    forceRefresh?: boolean
  ) => {
    const effectiveChainId = chainId ?? 8453;
    const shouldForceRefresh = forceRefresh ?? false;
    const vaultVersion = getVaultVersion(address);
    const cacheKey = `vault-complete-${vaultVersion}-${address}-${effectiveChainId}`;
    
    // Check if we already have fresh data (unless forcing refresh)
    // Use ref to read current state without adding to dependencies
    if (!shouldForceRefresh) {
      const currentVaultData = vaultDataRef.current[address];
      if (currentVaultData?.lastFetched) {
        const ageMs = Date.now() - currentVaultData.lastFetched;
        if (currentVaultData.basic && ageMs < CLIENT_VAULT_DATA_CACHE_MS) {
          return;
        }
        // Failed fetches (e.g. rate limit) must not retry in a tight loop
        if (currentVaultData.error && ageMs < MORPHO_FETCH_ERROR_COOLDOWN_MS) {
          return;
        }
      }
    }

    // Request deduplication
    if (pendingRequests.current.has(cacheKey)) {
      return pendingRequests.current.get(cacheKey);
    }

    const fetchPromise = (async () => {
      commitVaultData((prev) => ({
        ...prev,
        [address]: {
          ...prev[address],
          loading: true,
          error: null,
        },
      }));

      try {
        // APY and vault metrics: /api/vault/v2/[address]/complete only (no v1 complete route).
        const response = await fetch(`/api/vault/${vaultVersion}/${address}/complete?chainId=${effectiveChainId}`);
        const data = await response.json();

        if (!response.ok) {
          const isRateLimited =
            response.status === 503 || data.error === 'Morpho API rate limit exceeded';
          throw new Error(
            isRateLimited
              ? 'Morpho API rate limit exceeded. Wait a few minutes and retry.'
              : data.details || data.error || 'Failed to fetch complete vault data'
          );
        }

        const vaultInfo = data.data.vaultByAddress;
        const liquidityBreakdown = (
          vaultInfo as { liquidityBreakdown?: VaultLiquidityBreakdown }
        ).liquidityBreakdown;
        
        // Extract curator name from metadata
        const curatorAddress = vaultInfo.state?.curator;
        const curatorName = vaultInfo.metadata?.curators?.[0]?.name;
        
        // APY: headline is Morpho netApy; grossApy for popover breakdown.
        const headlineApy = vaultInfo.state?.netApy ?? vaultInfo.state?.apy ?? 0;
        const grossApy =
          (vaultInfo.state as { grossApy?: number })?.grossApy ?? headlineApy;
        const morphoAvgNetApy = vaultInfo.state?.avgNetApy ?? headlineApy;
        const netApyWithoutRewards = vaultInfo.state?.netApyWithoutRewards || 0;

        const vaultRewards = vaultInfo.state?.rewards || [];
        const totalRewardsApr = Math.max(0, morphoAvgNetApy - netApyWithoutRewards);
        const primaryRewardSymbol = vaultRewards.length > 0 
          ? vaultRewards[0]?.asset?.symbol || 'MORPHO'
          : 'MORPHO'; // Default to MORPHO since most rewards are in MORPHO token
        
        // Share price handling
        // For v1 vaults: sharePrice from GraphQL is in raw format (asset decimals), convert to decimal
        // For v2 vaults: sharePrice is already calculated in decimal format by the API route
        // This is sharePrice in tokens (not USD) - tokens per share
        const rawSharePrice = vaultInfo.state?.sharePrice;
        const assetDecimals = vaultInfo.asset?.decimals || 18;
        
        let sharePriceInTokens = 1;
        if (rawSharePrice !== undefined && rawSharePrice !== null) {
          // Check if sharePrice is already in decimal format (v2) or raw format (v1)
          // If it's a number and less than a reasonable threshold (e.g., 1000), assume it's already decimal
          // Otherwise, treat it as raw and convert
          if (typeof rawSharePrice === 'number' && rawSharePrice < 1000 && rawSharePrice > 0) {
            // Already in decimal format (v2)
            sharePriceInTokens = rawSharePrice;
          } else {
            // Raw format (v1), convert to decimal
            try {
              sharePriceInTokens = parseFloat(formatUnits(BigInt(Math.floor(rawSharePrice)), assetDecimals));
            } catch {
              sharePriceInTokens = 1;
            }
          }
        }
        
        const sharePriceUsd = vaultInfo.state?.sharePriceUsd || 0;
        const registryVault = findVaultByAddress(address);

        // Build the vault object
        const vault: Vault = {
          address: vaultInfo.address,
          name: registryVault?.name || vaultInfo.name || `Vault ${address.slice(0, 6)}...${address.slice(-4)}`,
          symbol: registryVault?.symbol || vaultInfo.asset?.symbol || 'UNKNOWN',
          vaultSymbol: registryVault?.vaultSymbol,
          chainId: effectiveChainId,
          version: vaultVersion,
          strategy: registryVault?.strategy,
          kind: registryVault?.kind,
          underlyingAddress: registryVault?.underlyingAddress,
          totalValueLocked: vaultInfo.state?.totalAssetsUsd || 0,
          totalAssets: vaultInfo.state?.totalAssets || '0',
          assetDecimals: assetDecimals,
          totalDeposits: vaultInfo.state?.totalAssetsUsd || 0,
          currentLiquidity:
            (vaultInfo as { liquidityUsd?: number }).liquidityUsd ??
            vaultInfo.state?.totalAssetsUsd ??
            0,
          liquidityAssets:
            (vaultInfo as { liquidity?: string }).liquidity ??
            vaultInfo.state?.totalAssets ??
            '0',
          liquidityBreakdown: liquidityBreakdown ?? undefined,
          sharePrice: sharePriceInTokens, // Share price in tokens (not USD) - tokens per share
          sharePriceUsd: sharePriceUsd, // Share price in USD
          apy: headlineApy,
          grossApy,
          netApyWithoutRewards: netApyWithoutRewards,
          rewardsApr: totalRewardsApr,
          rewardSymbol: primaryRewardSymbol,
          whitelisted: vaultInfo.whitelisted ?? false,
          status: 'active',
          curator: curatorName || curatorAddress || 'Unknown Curator',
          curatorAddress: curatorAddress,
          guardianAddress: vaultInfo.state?.guardian,
          ownerAddress: vaultInfo.state?.owner || '',
          allocators: vaultInfo.allocators?.map((alloc: { address: string }) => alloc.address) || [],
          performanceFee:
            ((vaultInfo as { performanceFee?: number }).performanceFee ??
              vaultInfo.state?.fee ??
              0) * 100,
          managementFee: ((vaultInfo as { managementFee?: number }).managementFee ?? 0) * 100,
          description: vaultInfo.metadata?.description || 'Morpho vault',
          timelockDuration: vaultInfo.state?.timelock || 0,
          lastUpdated: new Date().toISOString(),
          isCurated: isCuratedVaultAddress(vaultInfo.address),
        };

        commitVaultData((prev) => ({
          ...prev,
          [address]: {
            basic: vault,
            loading: false,
            error: null,
            lastFetched: Date.now(),
          },
        }));

      } catch (error) {
        commitVaultData((prev) => ({
          ...prev,
          [address]: {
            ...prev[address],
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            lastFetched: Date.now(),
          },
        }));
      } finally {
        pendingRequests.current.delete(cacheKey);
      }
    })();

    pendingRequests.current.set(cacheKey, fetchPromise);
    return fetchPromise;
  }, [commitVaultData]);



  const getVaultData = useCallback((address: string): MorphoVaultData | null => {
    const data = vaultData[address];
    if (!data?.basic) return null;

    // Combine all data sources into MorphoVaultData format
    const basic = data.basic;


    return {
      ...basic,
      totalValueLocked: basic.totalValueLocked || 0,
      totalSupply: basic.totalSupply ?? '0',
      apy: basic.apy || 0,
      grossApy: basic.grossApy ?? basic.apy ?? 0,
      netApyWithoutRewards: basic.netApyWithoutRewards || 0,
      rewardsApr: basic.rewardsApr || 0,
      rewardSymbol: basic.rewardSymbol || '',
      apyChange: 0,
      totalDeposits: basic.totalDeposits || 0,
      currentLiquidity: basic.currentLiquidity || 0,
      liquidityAssets: basic.liquidityAssets,
      liquidityBreakdown: basic.liquidityBreakdown,
      sharePrice: basic.sharePrice || 1,
      sharePriceUsd: basic.sharePriceUsd || 0,
      whitelisted: basic.whitelisted ?? false,
      timelockDuration: basic.timelockDuration || 0,
      guardianAddress: basic.guardianAddress || '',
      oracleAddress: basic.oracleAddress || '',
      ownerAddress: basic.ownerAddress || '',
      allocators: basic.allocators || [],
      status: basic.status || 'active',
      curator: basic.curator || 'Morpho Labs',
      curatorAddress: basic.curatorAddress || '',
      performanceFee: basic.performanceFee || 0.0,
      managementFee: basic.managementFee || 0.0,
      description: basic.description || 'High-yield lending vault optimized for stablecoin deposits with automated market allocation.',
      strategy: basic.strategy,
      kind: basic.kind,
      underlyingAddress: basic.underlyingAddress,
      isCurated: basic.isCurated ?? isCuratedVaultAddress(address),
    };
  }, [vaultData]);

  const isLoading = useCallback((address: string) => {
    return vaultData[address]?.loading || false;
  }, [vaultData]);

  const hasError = useCallback((address: string) => {
    return !!vaultData[address]?.error;
  }, [vaultData]);

  const getVaultError = useCallback((address: string): string | null => {
    return vaultData[address]?.error ?? null;
  }, [vaultData]);

  const isStaleData = useCallback((address: string) => {
    const data = vaultData[address];
    if (!data) return false;
    return isDataStale(data.lastFetched);
  }, [vaultData, isDataStale]);

  const preloadVaults = useCallback(async (vaults: Vault[]) => {
    for (let i = 0; i < vaults.length; i += MORPHO_PRELOAD_BATCH_SIZE) {
      const batch = vaults.slice(i, i + MORPHO_PRELOAD_BATCH_SIZE);
      await Promise.allSettled(
        batch.map((vault) => fetchCompleteVaultData(vault.address, vault.chainId, false))
      );
    }
  }, [fetchCompleteVaultData]);

  const value: VaultDataContextType = {
    vaultData,
    fetchVaultData: fetchCompleteVaultData,
    getVaultData,
    isLoading,
    hasError,
    getVaultError,
    isStaleData,
    preloadVaults,
  };

  return (
    <VaultDataContext.Provider value={value}>
      {children}
    </VaultDataContext.Provider>
  );
}

export function useVaultData() {
  const context = useContext(VaultDataContext);
  if (context === undefined) {
    throw new Error('useVaultData must be used within a VaultDataProvider');
  }
  return context;
}
