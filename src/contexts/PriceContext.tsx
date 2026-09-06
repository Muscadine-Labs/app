'use client';

import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { useQuery } from '@tanstack/react-query';

interface PriceData {
  btc: number | null;
  eth: number | null;
  loading: boolean;
  error: string | null;
}

const defaultPrices: PriceData = {
  btc: null,
  eth: null,
  loading: false,
  error: null,
};

const PriceContext = createContext<PriceData>(defaultPrices);
const EnablePriceFetchContext = createContext<(() => void) | null>(null);

export function PriceProvider({ children }: { children: ReactNode }) {
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const enableFetch = useCallback(() => {
    setFetchEnabled(true);
  }, []);

  const { data, error, isLoading } = useQuery({
    queryKey: ['crypto-prices'],
    enabled: fetchEnabled,
    queryFn: async () => {
      let cachedData: string | null = null;
      let cachedTimestamp: string | null = null;

      if (typeof window !== 'undefined') {
        cachedData = localStorage.getItem('crypto-prices');
        cachedTimestamp = localStorage.getItem('crypto-prices-timestamp');
      }

      const now = Date.now();
      const CACHE_DURATION = 5 * 60 * 1000;

      const parseCachedPrices = (raw: string | null) => {
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as { btc?: number | null; eth?: number | null };
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {
          // Ignore corrupt localStorage
        }
        return null;
      };

      const cachedPrices = parseCachedPrices(cachedData);
      const cachedAt = cachedTimestamp ? parseInt(cachedTimestamp, 10) : NaN;

      if (cachedPrices && Number.isFinite(cachedAt) && now - cachedAt < CACHE_DURATION) {
        return cachedPrices;
      }

      const response = await fetch('/api/prices?symbols=BTC,ETH');
      if (!response.ok) {
        if (cachedPrices) {
          return cachedPrices;
        }
        throw new Error('Failed to fetch prices');
      }

      const freshData = await response.json();
      if (!freshData || typeof freshData !== 'object' || freshData.error) {
        if (cachedPrices) return cachedPrices;
        throw new Error('Failed to fetch prices');
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('crypto-prices', JSON.stringify(freshData));
        localStorage.setItem('crypto-prices-timestamp', now.toString());
      }

      return freshData;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 3,
  });

  const prices = useMemo(
    () => ({
      btc: data?.btc ?? null,
      eth: data?.eth ?? null,
      loading: fetchEnabled ? isLoading : false,
      error: error?.message ?? null,
    }),
    [data, error, isLoading, fetchEnabled]
  );

  return (
    <EnablePriceFetchContext.Provider value={enableFetch}>
      <PriceContext.Provider value={prices}>{children}</PriceContext.Provider>
    </EnablePriceFetchContext.Provider>
  );
}

export const usePrices = () => {
  const enableFetch = useContext(EnablePriceFetchContext);

  useEffect(() => {
    enableFetch?.();
  }, [enableFetch]);

  return useContext(PriceContext);
};
