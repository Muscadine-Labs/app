'use client';

import { useMemo } from 'react';
import {
  EARNINGS_PERIOD_SECONDS,
  assetsAtOrBefore,
  firstPositivePositionTimestamp,
  periodInterestRaw,
  projectedInterestRaw,
  type ActivityFlowEvent,
  type EarningsPeriodId,
} from '@/lib/interest-utils';
import {
  formatCurrency,
  formatVaultDetailTokenAmount,
  chartTokenAmountToRaw,
} from '@/lib/formatter';
import { Skeleton } from '@/components/ui/Skeleton';
import { VaultStatPopover } from './VaultStatPopover';

const PAST_ROWS: Array<{ id: EarningsPeriodId; label: string }> = [
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'year', label: 'Past year' },
];

const PROJECTED_ROWS: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Next week' },
  { days: 30, label: 'Next month' },
  { days: 365, label: 'Next year' },
];

interface VaultEarningsBreakdownProps {
  symbol: string;
  decimals: number;
  allTimeRaw: string;
  allTimeUsd: number;
  currentAssetsRaw: bigint;
  history: Array<{ timestamp: number; assets: number }>;
  events: ActivityFlowEvent[] | null;
  nowTs: number;
  assetPriceUsd: number;
  netApy: number;
  isConnected: boolean;
  isLoading: boolean;
}

function AmountPair({
  raw,
  usd,
  decimals,
  symbol,
  emphasized = false,
}: {
  raw: bigint | string;
  usd: number;
  decimals: number;
  symbol: string;
  emphasized?: boolean;
}) {
  const rawStr = typeof raw === 'bigint' ? raw.toString() : raw;
  return (
    <div className="text-right">
      <p
        className={`tabular-nums ${
          emphasized
            ? 'text-xs font-semibold text-[var(--foreground)]'
            : 'text-xs font-medium text-[var(--foreground)]'
        }`}
      >
        {formatVaultDetailTokenAmount(rawStr, decimals, symbol)}
      </p>
      <p className="text-[10px] tabular-nums text-[var(--foreground-secondary)]">
        {formatCurrency(Math.max(0, usd))}
      </p>
    </div>
  );
}

function BreakdownRow({
  label,
  raw,
  usd,
  decimals,
  symbol,
  emphasized = false,
}: {
  label: string;
  raw: bigint | string;
  usd: number;
  decimals: number;
  symbol: string;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span
        className={`text-xs ${
          emphasized
            ? 'font-semibold text-[var(--foreground)]'
            : 'text-[var(--foreground-secondary)]'
        }`}
      >
        {label}
      </span>
      <AmountPair
        raw={raw}
        usd={usd}
        decimals={decimals}
        symbol={symbol}
        emphasized={emphasized}
      />
    </div>
  );
}

export function VaultEarningsBreakdown({
  symbol,
  decimals,
  allTimeRaw,
  allTimeUsd,
  currentAssetsRaw,
  history,
  events,
  nowTs,
  assetPriceUsd,
  netApy,
  isConnected,
  isLoading,
}: VaultEarningsBreakdownProps) {
  const firstPositionTs = useMemo(
    () => firstPositivePositionTimestamp(history),
    [history]
  );

  const pastRows = useMemo(() => {
    if (nowTs <= 0 || !events || events.length === 0) return [];

    return PAST_ROWS.flatMap((row) => {
      const periodSeconds = EARNINGS_PERIOD_SECONDS[row.id];
      const startTs = nowTs - periodSeconds;
      const startAssets = assetsAtOrBefore(history, startTs);
      const result = periodInterestRaw({
        nowTs,
        periodSeconds,
        firstPositionTs,
        startPositionRaw: chartTokenAmountToRaw(startAssets, decimals),
        currentPositionRaw: currentAssetsRaw,
        events,
      });
      if (result.hidden) return [];
      const earnedDecimal = Number(result.earnedRaw) / 10 ** decimals;
      return [
        {
          label: row.label,
          raw: result.earnedRaw,
          usd: earnedDecimal * assetPriceUsd,
        },
      ];
    });
  }, [
    assetPriceUsd,
    currentAssetsRaw,
    decimals,
    events,
    firstPositionTs,
    history,
    nowTs,
  ]);

  const projectedRows = useMemo(() => {
    if (currentAssetsRaw <= BigInt(0) || netApy <= 0) return [];
    return PROJECTED_ROWS.map((row) => {
      const raw = projectedInterestRaw(currentAssetsRaw, netApy, row.days);
      const earnedDecimal = Number(raw) / 10 ** decimals;
      return {
        label: row.label,
        raw,
        usd: earnedDecimal * assetPriceUsd,
      };
    });
  }, [assetPriceUsd, currentAssetsRaw, decimals, netApy]);

  if (!isConnected) {
    return (
      <div className="flex-1 min-w-0 sm:text-right">
        <p className="text-xs text-[var(--foreground-secondary)] mb-1">Earned Interest</p>
        <p className="text-sm text-[var(--foreground-muted)]">Connect wallet</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 min-w-0 sm:text-right">
        <p className="text-xs text-[var(--foreground-secondary)] mb-1">Earned Interest</p>
        <Skeleton width="8rem" height="2rem" className="sm:ml-auto" />
      </div>
    );
  }

  let parsedAllTimeRaw: bigint | null = null;
  try {
    parsedAllTimeRaw = BigInt(allTimeRaw || '0');
  } catch {
    parsedAllTimeRaw = null;
  }
  const showZero =
    parsedAllTimeRaw !== null && parsedAllTimeRaw <= BigInt(0) && allTimeUsd <= 0;

  return (
    <div className="flex-1 min-w-0 sm:text-right">
      <div className="flex items-center gap-1.5 mb-1 sm:justify-end">
        <p className="text-xs text-[var(--foreground-secondary)]">Earned Interest</p>
        <VaultStatPopover ariaLabel="Past earnings" align="end">
          {pastRows.length > 0 ? (
            pastRows.map((row) => (
              <BreakdownRow
                key={row.label}
                label={row.label}
                raw={row.raw}
                usd={row.usd}
                decimals={decimals}
                symbol={symbol}
              />
            ))
          ) : (
            <p className="py-2 text-xs text-[var(--foreground-muted)]">
              Past week, month, and year hide until you had a position at the start of
              that window.
            </p>
          )}
          <div className="border-t border-[var(--border-subtle)] mt-1 pt-1">
            <BreakdownRow
              label="All time"
              raw={allTimeRaw || '0'}
              usd={allTimeUsd}
              decimals={decimals}
              symbol={symbol}
              emphasized
            />
          </div>
          {pastRows.length > 0 ? (
            <p className="text-[10px] text-[var(--foreground-muted)] mt-2 leading-relaxed">
              Past week/month/year hide until you had a position at the start of that
              window.
            </p>
          ) : null}
        </VaultStatPopover>
      </div>
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
      {projectedRows.length > 0 ? (
        <div className="flex items-center gap-1.5 mt-2 sm:justify-end">
          <p className="text-[10px] text-[var(--foreground-muted)]">Estimated</p>
          <VaultStatPopover ariaLabel="Estimated future earnings" align="end">
            <p className="text-[10px] text-[var(--foreground-muted)] pb-1">
              If current net APY holds
            </p>
            {projectedRows.map((row) => (
              <BreakdownRow
                key={row.label}
                label={row.label}
                raw={row.raw}
                usd={row.usd}
                decimals={decimals}
                symbol={symbol}
              />
            ))}
            <p className="text-[10px] text-[var(--foreground-muted)] mt-2 leading-relaxed">
              Estimates are not a guarantee.
            </p>
          </VaultStatPopover>
        </div>
      ) : null}
    </div>
  );
}
