'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { logger } from '@/lib/logger';

export interface VaultEarnedInterest {
  earnedInterest: number;
  earnedInterestUsd: number;
  earnedInterestRaw: string;
  assetDecimals: number;
  source: string;
  isLoading: boolean;
  error: string | null;
}

const EMPTY_STATE: VaultEarnedInterest = {
  earnedInterest: 0,
  earnedInterestUsd: 0,
  earnedInterestRaw: '0',
  assetDecimals: 18,
  source: 'none',
  isLoading: false,
  error: null,
};

export function useVaultEarnedInterest(
  vaultAddress: string | undefined,
  assetSymbol?: string
): VaultEarnedInterest {
  const { address } = useAccount();
  const enabled = Boolean(address && vaultAddress);
  const queryKey = `${address ?? ''}:${vaultAddress ?? ''}:${assetSymbol ?? ''}`;

  const [cached, setCached] = useState<{
    key: string;
    state: VaultEarnedInterest;
  }>({ key: '', state: EMPTY_STATE });

  useEffect(() => {
    if (!enabled || !address || !vaultAddress) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams({
          userAddress: address,
          chainId: '8453',
        });
        if (assetSymbol) {
          params.set('symbol', assetSymbol);
        }

        const response = await fetch(
          `/api/vault/v2/${vaultAddress}/earned-interest?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch earned interest');
        }

        const data = await response.json();

        if (cancelled) return;

        setCached({
          key: queryKey,
          state: {
            earnedInterest: data.earnedInterest ?? 0,
            earnedInterestUsd: data.earnedInterestUsd ?? 0,
            earnedInterestRaw: data.earnedInterestRaw ?? '0',
            assetDecimals: data.assetDecimals ?? 18,
            source: data.source ?? 'unknown',
            isLoading: false,
            error: null,
          },
        });
      } catch (err) {
        if (cancelled) return;
        logger.warn('Earned interest fetch failed', {
          vaultAddress,
          error: err instanceof Error ? err.message : String(err),
        });
        setCached({
          key: queryKey,
          state: {
            ...EMPTY_STATE,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load',
          },
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [address, vaultAddress, assetSymbol, enabled, queryKey]);

  return useMemo((): VaultEarnedInterest => {
    if (!enabled) {
      return EMPTY_STATE;
    }
    if (cached.key !== queryKey) {
      return { ...EMPTY_STATE, isLoading: true };
    }
    return cached.state;
  }, [enabled, cached, queryKey]);
}
