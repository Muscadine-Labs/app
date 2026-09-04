'use client';

import { useEffect, useState, useRef } from 'react';
import { MorphoVaultData } from '@/types/vault';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';
import { formatMorphoMarketRateLabel } from '@/lib/morpho-market-url';
import { getVaultAnalyticsUrl } from '@/lib/vault-utils';
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

function isVaultTargetList(rows: VaultMarketAllocation[]): boolean {
  return rows.some((row) => row.kind === 'vault') && !rows.some((row) => row.kind === 'market');
}

function isNestedAllocation(row: VaultMarketAllocation): boolean {
  return (row.nestLevel ?? 0) > 0;
}

function isVaultGroupHeader(row: VaultMarketAllocation): boolean {
  return row.kind === 'vault';
}

function formatAllocationType(row: VaultMarketAllocation): string {
  if (row.kind === 'idle') return '—';
  if (row.kind === 'vault') return 'Vault';
  return formatMorphoMarketRateLabel(row.rateType, row.lltv) ?? '—';
}

function sizeColumnLabel(vaultTargets: boolean): string {
  return vaultTargets ? 'TVL' : 'Market size';
}

function nameColumnLabel(vaultTargets: boolean): string {
  return vaultTargets ? 'Vault' : 'Market';
}

function formatSizeShortLabel(row: VaultMarketAllocation): string {
  return row.kind === 'vault' ? 'TVL' : 'Size';
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

/** Compact line when Type / Allocated / APY columns are hidden. */
function formatCompactRowSummary(
  row: VaultMarketAllocation,
  valueType: AllocatedValueType
): string {
  if (isVaultGroupHeader(row)) {
    return '';
  }

  const parts: string[] = [];

  if (row.kind === 'market') {
    const typeLabel = formatAllocationType(row);
    if (typeLabel !== '—') parts.push(typeLabel);
  }

  parts.push(formatAllocated(row, valueType));

  const apy = formatApy(row.apy);
  if (apy !== '—') parts.push(apy);

  const liq = formatOptionalUsd(row.liquidityUsd);
  if (liq !== '—') parts.push(`Liq ${liq}`);

  const size = formatOptionalUsd(row.marketSizeUsd);
  if (size !== '—') parts.push(`${formatSizeShortLabel(row)} ${size}`);

  return parts.join(' · ');
}

function AllocationMarketName({ row }: { row: VaultMarketAllocation }) {
  if (row.kind === 'market' && row.morphoUrl) {
    return (
      <a
        href={row.morphoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
      >
        {row.name}
      </a>
    );
  }

  if (row.kind === 'vault') {
    const href = row.href ?? (row.vaultAddress ? getVaultAnalyticsUrl(row.vaultAddress) : undefined);
    if (href) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
        >
          {row.name}
        </a>
      );
    }
  }

  return <span className="font-medium text-[var(--foreground)]">{row.name}</span>;
}

function AllocationVaultGroupLabel({
  row,
  allocatedValueType,
}: {
  row: VaultMarketAllocation;
  allocatedValueType: AllocatedValueType;
}) {
  return (
    <span className="whitespace-nowrap font-medium text-[var(--foreground)]">
      {formatAllocated(row, allocatedValueType)}{' '}
      <span className="font-normal text-[var(--foreground-muted)]">to</span>{' '}
      <AllocationMarketName row={row} />
    </span>
  );
}

function AllocationNameCell({
  row,
  allocatedValueType,
  showGroupHeader,
}: {
  row: VaultMarketAllocation;
  allocatedValueType: AllocatedValueType;
  showGroupHeader: boolean;
}) {
  if (showGroupHeader && isVaultGroupHeader(row)) {
    return <AllocationVaultGroupLabel row={row} allocatedValueType={allocatedValueType} />;
  }
  return <AllocationMarketName row={row} />;
}

function AllocationMobileCard({
  row,
  allocatedValueType,
  vaultTokenLabel,
  showGroupHeader,
}: {
  row: VaultMarketAllocation;
  allocatedValueType: AllocatedValueType;
  vaultTokenLabel: string;
  showGroupHeader: boolean;
}) {
  const allocatedLabel =
    allocatedValueType === 'usd' ? 'Allocated (USD)' : `Allocated (${vaultTokenLabel})`;
  const nested = isNestedAllocation(row);

  if (showGroupHeader && isVaultGroupHeader(row)) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]/40 px-3 py-2.5 overflow-x-auto">
        <span className="whitespace-nowrap">
          <AllocationVaultGroupLabel row={row} allocatedValueType={allocatedValueType} />
        </span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]/40 px-3 py-2.5 space-y-2 ${
        nested ? 'ml-3' : ''
      }`}
    >
      <AllocationMarketName row={row} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {row.kind === 'market' && (
          <div>
            <dt className="text-[var(--foreground-muted)]">Type</dt>
            <dd className="text-[var(--foreground-secondary)] tabular-nums">{formatAllocationType(row)}</dd>
          </div>
        )}
        {row.kind === 'vault' && (
          <div>
            <dt className="text-[var(--foreground-muted)]">Type</dt>
            <dd className="text-[var(--foreground-secondary)] tabular-nums">{formatAllocationType(row)}</dd>
          </div>
        )}
        <div>
          <dt className="text-[var(--foreground-muted)]">{allocatedLabel}</dt>
          <dd className="text-[var(--foreground)] tabular-nums">{formatAllocated(row, allocatedValueType)}</dd>
        </div>
        <div>
          <dt className="text-[var(--foreground-muted)]">APY</dt>
          <dd className="text-[var(--foreground)] tabular-nums">{formatApy(row.apy)}</dd>
        </div>
        <div>
          <dt className="text-[var(--foreground-muted)]">Liquidity</dt>
          <dd className="text-[var(--foreground-secondary)] tabular-nums">{formatOptionalUsd(row.liquidityUsd)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[var(--foreground-muted)]">{row.kind === 'vault' ? 'TVL' : 'Market size'}</dt>
          <dd className="text-[var(--foreground-secondary)] tabular-nums">{formatOptionalUsd(row.marketSizeUsd)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Shrink-wrap cells — table stays only as wide as content (no stretched gaps). */
const METRIC_CELL =
  'py-1.5 px-2 sm:py-2 sm:px-2.5 lg:py-2.5 lg:px-3 tabular-nums whitespace-nowrap w-[1%]';
const TYPE_CELL = `${METRIC_CELL} text-[var(--foreground-secondary)]`;
const AMOUNT_CELL = `${METRIC_CELL} text-right text-[var(--foreground)]`;
const MARKET_CELL_BASE =
  'py-1.5 pr-1 sm:py-2 sm:pr-1.5 lg:py-2.5 lg:pr-2 w-[1%]';
const MARKET_CELL = `${MARKET_CELL_BASE} pl-2 sm:pl-2.5 lg:pl-3 whitespace-nowrap`;
const NESTED_MARKET_CELL = `${MARKET_CELL_BASE} pl-5 sm:pl-6 lg:pl-8 whitespace-nowrap`;
const GROUP_HEADER_CELL =
  'py-1.5 pl-2 pr-2 sm:py-2 sm:pl-2.5 sm:pr-2.5 lg:py-2.5 lg:pl-3 lg:pr-3 whitespace-nowrap';
const TH = 'font-medium text-[var(--foreground-secondary)]';

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

    const abortController = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/vault/v2/${vaultData.address}/allocations?chainId=${vaultData.chainId}`,
          { signal: abortController.signal }
        );
        const data = await response.json();

        if (abortController.signal.aborted) return;

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
        if (err instanceof Error && err.name === 'AbortError') return;
        logger.warn('Vault allocations fetch failed', {
          vaultAddress: vaultData.address,
          error: err instanceof Error ? err.message : String(err),
        });
        setAllocations([]);
        setError('Failed to load allocations');
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      abortController.abort();
    };
  }, [active, fetchKey, vaultData.address, vaultData.chainId]);

  const vaultTokenLabel = vaultData.symbol || 'Token';
  const allocatedHeader =
    allocatedValueType === 'usd' ? 'Allocated (USD)' : `Allocated (${vaultTokenLabel})`;
  const vaultTargets = isVaultTargetList(allocations);
  const showGroupHeader =
    allocations.some((row) => row.kind === 'vault') &&
    allocations.some((row) => row.kind === 'market');
  const analyticsAddress =
    vaultData.underlyingAddress ||
    allocations.find((row) => row.kind === 'vault')?.vaultAddress ||
    vaultData.address;
  const analyticsHref = getVaultAnalyticsUrl(analyticsAddress);
  const allocationsDescription = vaultTargets
    ? 'Vault capital allocated to the underlying Morpho vault'
    : showGroupHeader
      ? 'Allocated to the underlying Morpho vault, then to its Morpho markets'
      : 'Vault capital deployed to Morpho markets and idle liquidity';

  return (
    <div className="space-y-3 min-h-[10rem]">
      {!embedded && (
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">Allocations</h3>
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
            {allocationsDescription}
          </p>
        </div>
      )}

      {loading ? (
        <div className="p-2 space-y-3">
          {[1, 2, 3].map((row) => (
            <Skeleton key={row} width="100%" height="4.5rem" />
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer touch-manipulation ${
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer touch-manipulation ${
                  allocatedValueType === 'usd'
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
                }`}
              >
                USD
              </button>
            </div>
          </div>

          {/* Too narrow: cards */}
          <div className="min-[30rem]:hidden space-y-2">
            {allocations.map((row) => (
              <AllocationMobileCard
                key={row.id}
                row={row}
                allocatedValueType={allocatedValueType}
                vaultTokenLabel={vaultTokenLabel}
                showGroupHeader={showGroupHeader}
              />
            ))}
          </div>

          {/*
            30rem+: responsive table (columns hug content — no stretched gaps).
            30–40rem: name + summary · 40rem+: Type/Allocated/APY · md+: Liquidity · xl+: TVL / Market size
          */}
          <div className="hidden min-[30rem]:block overflow-x-auto -mx-1 px-1">
            <table className="table-auto text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[10px] sm:text-xs">
                  <th className={`${MARKET_CELL} ${TH} text-left`}>{nameColumnLabel(vaultTargets)}</th>
                  <th className={`${TYPE_CELL} ${TH} text-left hidden min-[40rem]:table-cell`}>Type</th>
                  <th className={`${AMOUNT_CELL} ${TH} hidden min-[40rem]:table-cell`}>{allocatedHeader}</th>
                  <th className={`${METRIC_CELL} ${TH} text-right hidden min-[40rem]:table-cell`}>APY</th>
                  <th className={`${METRIC_CELL} ${TH} text-right hidden md:table-cell`}>Liquidity</th>
                  <th className={`${METRIC_CELL} ${TH} text-right hidden xl:table-cell`}>
                    {sizeColumnLabel(vaultTargets)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((row) => {
                  const sizeShort = formatSizeShortLabel(row);
                  const sizeValue = formatOptionalUsd(row.marketSizeUsd);
                  const groupHeader = showGroupHeader && isVaultGroupHeader(row);
                  const nested = isNestedAllocation(row);
                  const compact = formatCompactRowSummary(row, allocatedValueType);
                  const nameCell = nested ? NESTED_MARKET_CELL : MARKET_CELL;
                  if (groupHeader) {
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--border-subtle)] last:border-b-0 bg-[var(--surface)]/40"
                      >
                        <td colSpan={6} className={GROUP_HEADER_CELL}>
                          <AllocationNameCell
                            row={row}
                            allocatedValueType={allocatedValueType}
                            showGroupHeader={showGroupHeader}
                          />
                        </td>
                      </tr>
                    );
                  }
                  return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface)]/50"
                  >
                    <td className={nameCell}>
                      <AllocationNameCell
                        row={row}
                        allocatedValueType={allocatedValueType}
                        showGroupHeader={showGroupHeader}
                      />
                      {compact ? (
                        <p
                          className="mt-0.5 text-[10px] leading-snug text-[var(--foreground-muted)] min-[40rem]:hidden"
                          title={compact}
                        >
                          {compact}
                        </p>
                      ) : null}
                      <p
                        className="mt-0.5 text-[10px] leading-snug text-[var(--foreground-muted)] hidden min-[40rem]:block md:hidden"
                        title={`Liq ${formatOptionalUsd(row.liquidityUsd)} · ${sizeShort} ${sizeValue}`}
                      >
                        Liq {formatOptionalUsd(row.liquidityUsd)} · {sizeShort} {sizeValue}
                      </p>
                      <p
                        className="mt-0.5 text-[10px] leading-snug text-[var(--foreground-muted)] hidden md:block xl:hidden"
                        title={`${sizeShort} ${sizeValue}`}
                      >
                        {sizeShort} {sizeValue}
                      </p>
                    </td>
                    <td className={`${TYPE_CELL} hidden min-[40rem]:table-cell`}>
                      {formatAllocationType(row)}
                    </td>
                    <td className={`${AMOUNT_CELL} hidden min-[40rem]:table-cell`}>
                      {formatAllocated(row, allocatedValueType)}
                    </td>
                    <td className={`${METRIC_CELL} text-right text-[var(--foreground)] hidden min-[40rem]:table-cell`}>
                      {formatApy(row.apy)}
                    </td>
                    <td className={`${METRIC_CELL} text-right text-[var(--foreground-secondary)] hidden md:table-cell`}>
                      {formatOptionalUsd(row.liquidityUsd)}
                    </td>
                    <td className={`${METRIC_CELL} text-right text-[var(--foreground-secondary)] hidden xl:table-cell`}>
                      {sizeValue}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && (
        <p className="text-[10px] leading-snug text-[var(--foreground-muted)] pt-1 text-center sm:text-right">
          For full allocations and analytics, visit{' '}
          <a
            href={analyticsHref}
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
