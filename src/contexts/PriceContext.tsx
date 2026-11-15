'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { BASE_CHAIN_ID, BASE_WETH_ADDRESS } from '@/lib/constants';
import { readRegistryAssets, type RegistryAsset } from '@/lib/registry-assets';
import { registerTokenLogo } from '@/lib/token-metadata';
import type { TokenPriceResponse } from '@/lib/token-prices';

interface PriceContextValue {
  /** USD price of a token by address; `'ETH'` (native) uses WETH. Null when unknown. */
  priceOf: (address: string | null | undefined) => number | null;
  /** USD price of a registry vault's asset. Null when unknown. */
  priceForVault: (vaultAddress: string | null | undefined) => number | null;
  /** A registry vault's asset (address, symbol, decimals), read on chain. */
  assetForVault: (vaultAddress: string | null | undefined) => RegistryAsset | null;
  /** Every distinct registry vault asset. Empty until the on-chain read finishes. */
  assets: RegistryAsset[];
  loading: boolean;
  error: string | null;
  /** Re-read prices now (wallet refreshes call this). */
  refresh: () => Promise<void>;
}

const NO_ASSETS: RegistryAsset[] = [];

const PriceContext = createContext<PriceContextValue | null>(null);

const PRICE_STALE_MS = 60_000;
const PRICE_REFETCH_MS = 5 * 60_000;

/**
 * Token list and USD prices for the whole app. Each registry vault's asset is read from the
 * vault (`asset()`), and prices for those assets come from Morpho (`/api/prices`), so a vault
 * in any token Morpho indexes is priced with no code change.
 */
export function PriceProvider({ children }: { children: ReactNode }) {
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });

  const registryQuery = useQuery({
    queryKey: ['registry-assets'],
    enabled: !!publicClient,
    queryFn: () => readRegistryAssets(publicClient!),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 3,
  });

  const assets = registryQuery.data?.assets ?? NO_ASSETS;
  // WETH is always priced: native ETH balances use it.
  const priceAddresses = useMemo(() => {
    const set = new Set<string>([BASE_WETH_ADDRESS.toLowerCase()]);
    for (const asset of assets) set.add(asset.address.toLowerCase());
    return [...set].sort();
  }, [assets]);

  const priceQuery = useQuery({
    queryKey: ['token-prices', priceAddresses.join(',')],
    queryFn: async (): Promise<TokenPriceResponse> => {
      const response = await fetch(`/api/prices?addresses=${priceAddresses.join(',')}`);
      const body = (await response.json().catch(() => null)) as Partial<TokenPriceResponse> | null;
      if (!response.ok || !body?.prices) throw new Error('Prices unavailable');
      for (const [address, logo] of Object.entries(body.logos ?? {})) registerTokenLogo(address, logo);
      return { prices: body.prices, logos: body.logos ?? {} };
    },
    staleTime: PRICE_STALE_MS,
    refetchInterval: PRICE_REFETCH_MS,
    // Keep the last prices while a new token list loads.
    placeholderData: (previous) => previous,
    retry: 2,
  });

  const prices = priceQuery.data?.prices;
  const byVault = registryQuery.data?.byVault;
  const { refetch: refetchPrices } = priceQuery;

  const priceOf = useCallback(
    (address: string | null | undefined) => {
      if (!address || !prices) return null;
      const key = address === 'ETH' ? BASE_WETH_ADDRESS.toLowerCase() : address.toLowerCase();
      return prices[key] ?? null;
    },
    [prices]
  );

  const assetForVault = useCallback(
    (vaultAddress: string | null | undefined) =>
      (vaultAddress && byVault?.[vaultAddress.toLowerCase()]) || null,
    [byVault]
  );

  const priceForVault = useCallback(
    (vaultAddress: string | null | undefined) => priceOf(assetForVault(vaultAddress)?.address),
    [priceOf, assetForVault]
  );

  const refresh = useCallback(async () => {
    await refetchPrices();
  }, [refetchPrices]);

  const value = useMemo<PriceContextValue>(
    () => ({
      priceOf,
      priceForVault,
      assetForVault,
      assets,
      loading: registryQuery.isLoading || priceQuery.isLoading,
      error: registryQuery.error?.message ?? priceQuery.error?.message ?? null,
      refresh,
    }),
    [
      priceOf,
      priceForVault,
      assetForVault,
      assets,
      registryQuery.isLoading,
      priceQuery.isLoading,
      registryQuery.error,
      priceQuery.error,
      refresh,
    ]
  );

  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function usePrices(): PriceContextValue {
  const context = useContext(PriceContext);
  if (!context) throw new Error('usePrices must be used within a PriceProvider');
  return context;
}
