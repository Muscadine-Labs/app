'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAddress } from 'viem';
import { usePublicClient } from 'wagmi';
import { BASE_CHAIN_ID } from '@/lib/constants';
import {
  applyDepositCapBuffer,
  DEPOSIT_CAPACITY_QUERY_KEY,
  readVaultDepositCapacity,
} from '@/lib/deposit-capacity';

const CAPACITY_STALE_MS = 15_000;
const CAPACITY_REFETCH_MS = 30_000;

function toCapRaw(headroom: bigint | null | undefined): bigint | null {
  return headroom === undefined || headroom === null ? null : applyDepositCapBuffer(headroom);
}

/**
 * Buffered deposit capacity for one vault. `capRaw` is null when no cap applies or the read has
 * not succeeded yet, so callers never block a deposit on a missing read.
 */
export function useVaultDepositCapacity(vaultAddress: string, enabled: boolean) {
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });

  const { data: headroom, dataUpdatedAt, refetch } = useQuery({
    queryKey: [...DEPOSIT_CAPACITY_QUERY_KEY, vaultAddress.toLowerCase()],
    enabled: enabled && Boolean(publicClient),
    staleTime: CAPACITY_STALE_MS,
    refetchInterval: enabled ? CAPACITY_REFETCH_MS : false,
    refetchOnWindowFocus: true,
    queryFn: () => readVaultDepositCapacity(publicClient!, getAddress(vaultAddress)),
  });

  const capRaw = useMemo(() => toCapRaw(headroom), [headroom]);

  /** Cap for the Deposit press: the cached read when it is fresh, otherwise a new read. */
  const readCapForSubmit = useCallback(async (): Promise<bigint | null> => {
    if (headroom !== undefined && Date.now() - dataUpdatedAt < CAPACITY_STALE_MS) {
      return toCapRaw(headroom);
    }
    const result = await refetch();
    return toCapRaw(result.data);
  }, [headroom, dataUpdatedAt, refetch]);

  return { capRaw, readCapForSubmit };
}
