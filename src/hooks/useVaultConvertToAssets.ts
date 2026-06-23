'use client';

import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { ERC4626_ABI } from '@/lib/abis';

export interface VaultSharesPosition {
  vaultAddress: string;
  shares: string;
}

/**
 * Batch ERC-4626 convertToAssets for vault positions (on-chain withdrawable asset amounts).
 */
export function useVaultConvertToAssetsMap(positions: VaultSharesPosition[]) {
  const entries = useMemo(() => {
    return positions.flatMap((position) => {
      try {
        const shares = BigInt(position.shares);
        if (shares <= BigInt(0)) return [];
        return [
          {
            key: position.vaultAddress.toLowerCase(),
            vaultAddress: position.vaultAddress,
            shares,
          },
        ];
      } catch {
        return [];
      }
    });
  }, [positions]);

  const contracts = useMemo(
    () =>
      entries.map((entry) => ({
        address: entry.vaultAddress as `0x${string}`,
        abi: ERC4626_ABI,
        functionName: 'convertToAssets' as const,
        args: [entry.shares] as const,
      })),
    [entries]
  );

  const { data, isLoading, isFetching } = useReadContracts({
    contracts,
    query: { enabled: entries.length > 0 },
  });

  const assetsByVault = useMemo(() => {
    const map = new Map<string, bigint>();
    entries.forEach((entry, index) => {
      const result = data?.[index]?.result;
      if (typeof result === 'bigint') {
        map.set(entry.key, result);
      }
    });
    return map;
  }, [data, entries]);

  return {
    assetsByVault,
    isLoading: entries.length > 0 && (isLoading || isFetching),
  };
}
