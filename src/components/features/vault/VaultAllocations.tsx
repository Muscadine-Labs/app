'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MorphoVaultData } from '@/types/vault';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';
import { formatMorphoMarketRateLabel } from '@/lib/morpho-market-url';
import {
  formatSmartCurrency,
  formatPercentage,
  formatVaultDetailTokenAmount,
  formatPositionUsd,
} from '@/lib/formatter';
import { Skeleton } from '@/components/ui/Skeleton';
import { isAllocationDust } from '@/lib/vault-details';

interface VaultAllocationsProps {
  vaultData: MorphoVaultData;
  /** From `useVaultAllocations` (shared with the Overview exposure figures). */
  allocations: VaultMarketAllocation[];
  loading: boolean;
  error: string | null;
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

function formatAllocationType(row: VaultMarketAllocation): string {
  if (row.kind === 'idle') return 'Unallocated Capital';
  return formatMorphoMarketRateLabel(row.rateType, row.lltv) ?? '—';
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

  return <span className="font-medium text-[var(--foreground)]">{row.name}</span>;
}

function AllocationMarketSize({ row }: { row: VaultMarketAllocation }) {
  if (row.marketSizeUsd == null) return null;
  return (
    <p className="text-[10px] leading-tight text-[var(--foreground-muted)] tabular-nums">
      Market size {formatOptionalUsd(row.marketSizeUsd)}
    </p>
  );
}

function AllocationMobileCard({
  row,
  allocatedValueType,
  vaultTokenLabel,
}: {
  row: VaultMarketAllocation;
  allocatedValueType: AllocatedValueType;
  vaultTokenLabel: string;
}) {
  const allocatedLabel =
    allocatedValueType === 'usd' ? 'Allocated (USD)' : `Allocated (${vaultTokenLabel})`;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]/40 px-3 py-2.5 space-y-2">
      <div>
        <AllocationMarketName row={row} />
        <AllocationMarketSize row={row} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-[var(--foreground-muted)]">Type</dt>
          <dd className="text-[var(--foreground)]">{formatAllocationType(row)}</dd>
        </div>
        <div>
          <dt className="text-[var(--foreground-muted)]">APY</dt>
          <dd className="text-[var(--foreground)] tabular-nums">{formatApy(row.apy)}</dd>
        </div>
        <div>
          <dt className="text-[var(--foreground-muted)]">{allocatedLabel}</dt>
          <dd className="text-[var(--foreground)] tabular-nums">{formatAllocated(row, allocatedValueType)}</dd>
        </div>
        <div>
          <dt className="text-[var(--foreground-muted)]">Liquidity</dt>
          <dd className="text-[var(--foreground)] tabular-nums">{formatOptionalUsd(row.liquidityUsd)}</dd>
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
const TH = 'font-medium text-[var(--foreground-secondary)]';

/** Default rows are positions above one cent, including idle cash above that. */
function isDefaultAllocation(row: VaultMarketAllocation): boolean {
  return !isAllocationDust(row.allocatedUsd);
}

type DroppedColumns = { liquidity: boolean; type: boolean };

const NO_DROPPED_COLUMNS: DroppedColumns = { liquidity: false, type: false };

/** Hide liquidity, then type, and only once the row would overflow. */
function columnsThatFit(container: HTMLElement): DroppedColumns {
  const cells = () => [...container.querySelectorAll<HTMLElement>('[data-col]')];
  const apply = (dropped: DroppedColumns) => {
    for (const cell of cells()) {
      const col = cell.dataset.col;
      const hide =
        (col === 'liquidity' && dropped.liquidity) ||
        (col === 'type' && dropped.type);
      cell.style.display = hide ? 'none' : 'table-cell';
    }
  };
  const overflows = () => container.scrollWidth > container.clientWidth + 1;

  const dropped: DroppedColumns = { ...NO_DROPPED_COLUMNS };
  apply(dropped);
  if (overflows()) dropped.liquidity = true;
  apply(dropped);
  if (overflows()) dropped.type = true;
  apply(dropped);
  return dropped;
}

function AllocationRowList({
  rows,
  allocatedValueType,
  vaultTokenLabel,
  allocatedHeader,
}: {
  rows: readonly VaultMarketAllocation[];
  allocatedValueType: AllocatedValueType;
  vaultTokenLabel: string;
  allocatedHeader: string;
}) {
  const tableRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = tableRef.current;
    if (!container) return;
    const fit = () => {
      if (container.clientWidth === 0) return;
      columnsThatFit(container);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [rows, allocatedValueType, allocatedHeader]);

  if (rows.length === 0) return null;
  return (
    <div className="@container">
      <div className="@min-[30rem]:hidden space-y-2">
        {rows.map((row) => (
          <AllocationMobileCard
            key={row.id}
            row={row}
            allocatedValueType={allocatedValueType}
            vaultTokenLabel={vaultTokenLabel}
          />
        ))}
      </div>
      <div ref={tableRef} className="@container hidden @min-[30rem]:block overflow-hidden -mx-1 px-1">
        <table className="table-auto text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[10px] sm:text-xs">
              <th data-col="market" className={`${MARKET_CELL} ${TH} text-left`}>
                Market
              </th>
              <th data-col="type" className={`${TYPE_CELL} ${TH} text-left`}>Type</th>
              <th data-col="allocated" className={`${AMOUNT_CELL} ${TH}`}>{allocatedHeader}</th>
              <th data-col="apy" className={`${METRIC_CELL} ${TH} text-right`}>APY</th>
              <th data-col="liquidity" className={`${METRIC_CELL} ${TH} text-right`}>Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface)]/50"
              >
                <td data-col="market" className={MARKET_CELL}>
                  <AllocationMarketName row={row} />
                  <AllocationMarketSize row={row} />
                </td>
                <td data-col="type" className={TYPE_CELL}>
                  {formatAllocationType(row)}
                </td>
                <td data-col="allocated" className={AMOUNT_CELL}>
                  {formatAllocated(row, allocatedValueType)}
                </td>
                <td data-col="apy" className={`${METRIC_CELL} text-right text-[var(--foreground)]`}>
                  {formatApy(row.apy)}
                </td>
                <td data-col="liquidity" className={`${METRIC_CELL} text-right text-[var(--foreground-secondary)]`}>
                  {formatOptionalUsd(row.liquidityUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Allocated markets listed above the dropdown; the rest move into it. */
const MAX_SHOWN_MARKETS = 7;

/** Largest allocation first, then larger markets among equal allocations (often zero). */
function sortByAllocation(rows: readonly VaultMarketAllocation[]): VaultMarketAllocation[] {
  return [...rows].sort((a, b) => {
    const byAllocation = b.allocatedUsd - a.allocatedUsd;
    if (byAllocation !== 0) return byAllocation;
    return (b.marketSizeUsd ?? 0) - (a.marketSizeUsd ?? 0);
  });
}

/** Same order as the main list, with idle cash last. It only ranks up when it holds funds. */
function sortOtherRows(rows: readonly VaultMarketAllocation[]): VaultMarketAllocation[] {
  return sortByAllocation(rows).sort((a, b) => {
    if (a.kind === 'idle') return 1;
    if (b.kind === 'idle') return -1;
    return 0;
  });
}

/** The top positions above one cent, at most seven. Idle joins them only while it holds funds. */
function pickShownRows(sorted: readonly VaultMarketAllocation[]): VaultMarketAllocation[] {
  return sorted.filter(isDefaultAllocation).slice(0, MAX_SHOWN_MARKETS);
}

/** Counts markets only: the idle row is listed too but is not a market. */
function otherMarketsMeta(rows: readonly VaultMarketAllocation[]): string {
  const markets = rows.filter((row) => row.kind !== 'idle').length;
  return markets === 1 ? '1 market' : `${markets} markets`;
}

export function VaultAllocations({
  vaultData,
  allocations,
  loading,
  error,
}: VaultAllocationsProps) {
  const [allocatedValueType, setAllocatedValueType] = useState<AllocatedValueType>('token');

  const vaultTokenLabel = vaultData.symbol || 'Token';
  const sortedAllocations = sortByAllocation(allocations);
  const visibleRows = pickShownRows(sortedAllocations);
  // The table lists the top allocations; the dropdown is every other market:
  // smaller positions and zero balances.
  const otherRows = sortOtherRows(sortedAllocations.filter((row) => !visibleRows.includes(row)));
  const allocatedHeader =
    allocatedValueType === 'usd' ? 'Allocated (USD)' : `Allocated (${vaultTokenLabel})`;

  return (
    <div className="space-y-3">

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

          <AllocationRowList
            rows={visibleRows}
            allocatedValueType={allocatedValueType}
            vaultTokenLabel={vaultTokenLabel}
            allocatedHeader={allocatedHeader}
          />

          {otherRows.length > 0 ? (
            <details className="group border-t border-[var(--border-subtle)] pt-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1.5 [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-medium text-[var(--foreground)]">
                  Other markets
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {otherMarketsMeta(otherRows)}
                  </span>
                  <svg
                    className="h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-open:rotate-180"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              </summary>
              <div className="pt-2">
                <AllocationRowList
                  rows={otherRows}
                  allocatedValueType={allocatedValueType}
                  vaultTokenLabel={vaultTokenLabel}
                  allocatedHeader={allocatedHeader}
                />
              </div>
            </details>
          ) : null}
        </>
      )}

    </div>
  );
}
