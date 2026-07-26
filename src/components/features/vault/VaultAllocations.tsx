'use client';

import { useEffect, useState, useRef } from 'react';
import { MorphoVaultData } from '@/types/vault';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';
import {
  formatSmartCurrency,
  formatPercentage,
  formatVaultDetailTokenAmount,
  formatPositionUsd,
} from '@/lib/formatter';
import { Skeleton } from '@/components/ui/Skeleton';
import { logger } from '@/lib/logger';

interface VaultAllocationsProps {
  vaultData: MorphoVaultData;
  /** Hide section title when rendered inside Overview tab bar. */
  embedded?: boolean;
  /** When false, skip fetch (parent keeps component mounted but hidden). */
  active?: boolean;
}

type AllocatedValueType = 'usd' | 'token';

function formatApy(apy: number | null): string {
  if (apy == null || !Number.isFinite(apy)) return '—';
  return formatPercentage(apy);
}

function formatOptionalUsd(value: number | null): string {
  if (value == null) return '—';
  return formatSmartCurrency(value, { alwaysTwoDecimals: true });
}

function formatAllocated(
  row: VaultMarketAllocation,
  valueType: AllocatedValueType
): string {
  if (valueType === 'usd') {
    return formatPositionUsd(row.allocatedUsd);
  }
  return formatVaultDetailTokenAmount(
    row.allocatedAssetsRaw,
    row.tokenDecimals,
    row.tokenSymbol
  );
}

export function VaultAllocations({
  vaultData,
  embedded = false,
  active = true,
}: VaultAllocationsProps) {
  const [allocations, setAllocations] = useState<VaultMarketAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allocatedValueType, setAllocatedValueType] = useState<AllocatedValueType>('token');
  const cacheRef = useRef<{ key: string; allocations: VaultMarketAllocation[] } | null>(null);

  const fetchKey = `${vaultData.address}:${vaultData.chainId}`;

  useEffect(() => {
    if (!active) return;

    if (cacheRef.current?.key === fetchKey) {
      setAllocations(cacheRef.current.allocations);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/vault/v2/${vaultData.address}/allocations?chainId=${vaultData.chainId}`
        );
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok && response.status !== 503) {
          throw new Error(data.details || data.error || 'Failed to load allocations');
        }

        const rows = Array.isArray(data.allocations) ? data.allocations : [];
        cacheRef.current = { key: fetchKey, allocations: rows };
        setAllocations(rows);
        if (data.error && rows.length === 0) {
          setError(data.error);
        } else {
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        logger.warn('Vault allocations fetch failed', {
          vaultAddress: vaultData.address,
          error: err instanceof Error ? err.message : String(err),
        });
        setAllocations([]);
        setError('Failed to load allocations');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [active, fetchKey, vaultData.address, vaultData.chainId]);

  const vaultTokenLabel = vaultData.symbol || 'Token';

  return (
    <div className="space-y-3 min-h-[12rem]">
      {!embedded && (
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">Allocations</h3>
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
            Vault capital deployed to Morpho markets and idle liquidity
          </p>
        </div>
      )}

      {loading ? (
        <div className="p-2 space-y-3">
          {[1, 2, 3].map((row) => (
            <div key={row} className="flex justify-between gap-4">
              <Skeleton width="6rem" height="1rem" />
              <Skeleton width="4rem" height="1rem" />
              <Skeleton width="4rem" height="1rem" />
              <Skeleton width="4rem" height="1rem" />
              <Skeleton width="3rem" height="1rem" />
            </div>
          ))}
        </div>
      ) : error && allocations.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--foreground-muted)]">{error}</div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <div className="flex shrink-0 items-center gap-2 rounded-lg p-1 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setAllocatedValueType('token')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer touch-manipulation ${
                  allocatedValueType === 'token'
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
                }`}
              >
                {vaultTokenLabel}
              </button>
              <button
                type="button"
                onClick={() => setAllocatedValueType('usd')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer touch-manipulation ${
                  allocatedValueType === 'usd'
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
                }`}
              >
                USD
              </button>
            </div>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-left text-xs text-[var(--foreground-secondary)]">
                <th className="px-3 py-2.5 font-medium">Market</th>
                <th className="px-3 py-2.5 font-medium text-right">
                  {allocatedValueType === 'usd' ? 'Allocated (USD)' : `Allocated (${vaultTokenLabel})`}
                </th>
                <th className="px-3 py-2.5 font-medium text-right">Market size</th>
                <th className="px-3 py-2.5 font-medium text-right">Liquidity</th>
                <th className="px-3 py-2.5 font-medium text-right">APY</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface)]/50"
                >
                  <td className="px-3 py-2.5">
                    {row.kind === 'market' && row.morphoUrl ? (
                      <a
                        href={row.morphoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline whitespace-nowrap"
                      >
                        {row.name}
                      </a>
                    ) : (
                      <span className="font-medium text-[var(--foreground)] whitespace-nowrap">
                        {row.name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[var(--foreground)] tabular-nums whitespace-nowrap">
                    {formatAllocated(row, allocatedValueType)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[var(--foreground-secondary)] tabular-nums whitespace-nowrap">
                    {formatOptionalUsd(row.marketSizeUsd)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[var(--foreground-secondary)] tabular-nums whitespace-nowrap">
                    {formatOptionalUsd(row.liquidityUsd)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[var(--foreground)] tabular-nums whitespace-nowrap">
                    {formatApy(row.apy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {!loading && (
        <p className="text-[10px] leading-snug text-[var(--foreground-muted)] pt-1 text-center sm:text-right">
          For full allocations and analytics, visit{' '}
          <a
            href="https://analytics.muscadine.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
          >
            Muscadine Analytics
          </a>
          .
        </p>
      )}
    </div>
  );
}
