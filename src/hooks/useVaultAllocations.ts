'use client';

import { useQuery } from '@tanstack/react-query';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';
import { BASE_CHAIN_ID, MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';

const ALLOCATIONS_STALE_MS = MORPHO_GRAPHQL_REVALIDATE_SECONDS * 1000;

async function fetchVaultAllocations(
  address: string,
  chainId: number
): Promise<VaultMarketAllocation[]> {
  const response = await fetch(`/api/vault/v2/${address}/allocations?chainId=${chainId}`);
  const data = await response.json().catch(() => ({}));
  // 503 is Morpho rate limiting: the route still returns an (empty) list.
  if (!response.ok && response.status !== 503) {
    throw new Error(data.details || data.error || 'Failed to load allocations');
  }
  const rows: VaultMarketAllocation[] = Array.isArray(data.allocations) ? data.allocations : [];
  if (data.error && rows.length === 0) throw new Error(data.error);
  return rows;
}

/** Morpho allocations for one vault (markets and idle). */
export function useVaultAllocations(
  address: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
) {
  const query = useQuery({
    queryKey: ['vault-allocations', address?.toLowerCase() ?? '', chainId],
    enabled: !!address,
    staleTime: ALLOCATIONS_STALE_MS,
    retry: 1,
    queryFn: () => fetchVaultAllocations(address!, chainId),
  });
  return {
    allocations: query.data ?? [],
    loading: query.isPending && !!address,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
