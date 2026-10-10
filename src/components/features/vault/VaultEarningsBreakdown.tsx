'use client';

import { useMemo } from 'react';
import {
  formatCurrency,
  formatVaultDetailTokenAmount,
} from '@/lib/formatter';
import { Skeleton } from '@/components/ui/Skeleton';

interface VaultEarningsBreakdownProps {
  symbol: string;
  decimals: number;
  allTimeRaw: string;
  allTimeUsd: number;
  isConnected: boolean;
  isLoading: boolean;
}

export function VaultEarningsBreakdown({
  symbol,
  decimals,
  allTimeRaw,
  allTimeUsd,
  isConnected,
  isLoading,
}: VaultEarningsBreakdownProps) {
  const parsedAllTimeRaw = useMemo(() => {
    try {
      return BigInt(allTimeRaw || '0');
    } catch {
      return null;
    }
  }, [allTimeRaw]);

  if (!isConnected) {
    return (
      <div className="min-w-0 text-right">
        <p className="text-xs text-[var(--foreground-secondary)] mb-1">Earned Interest</p>
        <p className="text-sm text-[var(--foreground-muted)]">Connect wallet</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-w-0 text-right">
        <p className="text-xs text-[var(--foreground-secondary)] mb-1">Earned Interest</p>
        <Skeleton width="8rem" height="2rem" className="ml-auto" />
      </div>
    );
  }

  const showZero =
    parsedAllTimeRaw !== null && parsedAllTimeRaw <= BigInt(0) && allTimeUsd <= 0;

  return (
    <div className="min-w-0 text-right">
      <p className="text-xs text-[var(--foreground-secondary)] mb-1">Earned Interest</p>
      {parsedAllTimeRaw === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">-</p>
      ) : (
        <>
          <p className="text-xl sm:text-2xl font-bold text-[var(--foreground)]">
            {formatVaultDetailTokenAmount(
              showZero ? '0' : allTimeRaw || '0',
              decimals,
              symbol
            )}
          </p>
          <p className="text-xs text-[var(--foreground-secondary)] mt-1">
            {formatCurrency(showZero ? 0 : allTimeUsd)}
          </p>
        </>
      )}
    </div>
  );
}
