'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MorphoVaultData } from '@/types/vault';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';
import { formatMorphoMarketRateLabel } from '@/lib/morpho-market-url';
import {
  findVaultByAddress,
  getDepositedVaultAddressSet,
  getVaultRoute,
} from '@/lib/vault-utils';
import { getMorphoVaultUrl } from '@/lib/liquidity-utils';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useExplorerVaults } from '@/contexts/ExplorerVaultsContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import { useWallet } from '@/contexts/WalletContext';
import {
  formatSmartCurrency,
  formatPercentage,
  formatVaultDetailTokenAmount,
  formatPositionUsd,
} from '@/lib/formatter';
import { Skeleton } from '@/components/ui/Skeleton';

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
  if (row.kind === 'idle') return '—';
  if (row.kind === 'vault') return 'Vault';
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

/** Compact line when Type / Allocated / APY columns are hidden. */
function formatCompactRowSummary(
  row: VaultMarketAllocation,
  valueType: AllocatedValueType
): string {
  const parts: string[] = [];

  if (row.kind !== 'idle') {
    const typeLabel = formatAllocationType(row);
    if (typeLabel !== '—') parts.push(typeLabel);
  }

  parts.push(formatAllocated(row, valueType));

  const apy = formatApy(row.apy);
  if (apy !== '—') parts.push(apy);

  const liq = formatOptionalUsd(row.liquidityUsd);
  if (liq !== '—') parts.push(`Liq ${liq}`);

  const size = formatOptionalUsd(row.marketSizeUsd);
  if (size !== '—') parts.push(`Size ${size}`);

  return parts.join(' · ');
}

/** In-app link when the wallet can open the vault's page, else the vault on Morpho. */
function useVaultRowHref(): (vaultAddress: string) => { href: string; internal: boolean } {
  const { listedVaultAddresses } = useExplorerVaults();
  const { eligibleVaultAddresses } = useVaultDepositGates();
  const { morphoHoldings } = useWallet();
  return (vaultAddress: string) => {
    const key = vaultAddress.toLowerCase();
    // Same rule as the vault page's access check: listed, depositable, or held.
    const pageOpen =
      !!findVaultByAddress(vaultAddress) &&
      (listedVaultAddresses.has(key) ||
        eligibleVaultAddresses.has(key) ||
        getDepositedVaultAddressSet(morphoHoldings.positions).has(key));
    return pageOpen
      ? { href: getVaultRoute(vaultAddress), internal: true }
      : { href: getMorphoVaultUrl(BASE_CHAIN_ID, vaultAddress), internal: false };
  };
}

const NAME_LINK_CLASS =
  'font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline';

function AllocationMarketName({ row }: { row: VaultMarketAllocation }) {
  const vaultRowHref = useVaultRowHref();
  if (row.kind === 'vault' && row.vaultAddress) {
    const { href, internal } = vaultRowHref(row.vaultAddress);
    return internal ? (
      <Link href={href} className={NAME_LINK_CLASS}>
        {row.name}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className={NAME_LINK_CLASS}>
        {row.name}
      </a>
    );
  }
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
      <AllocationMarketName row={row} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {row.kind !== 'idle' && (
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
          <dt className="text-[var(--foreground-muted)]">
            {row.kind === 'vault' ? 'Total deposits' : 'Market size'}
          </dt>
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
const TH = 'font-medium text-[var(--foreground-secondary)]';

export function VaultAllocations({
  vaultData,
  allocations,
  loading,
  error,
}: VaultAllocationsProps) {
  const [allocatedValueType, setAllocatedValueType] = useState<AllocatedValueType>('token');

  const vaultTokenLabel = vaultData.symbol || 'Token';
  // A wrapper allocates only to its underlying vault: label the columns for a vault.
  const vaultRowsOnly =
    allocations.some((row) => row.kind === 'vault') &&
    allocations.every((row) => row.kind !== 'market');
  const allocatedHeader =
    allocatedValueType === 'usd' ? 'Allocated (USD)' : `Allocated (${vaultTokenLabel})`;
  const underlyingVault = vaultData.underlyingAddress
    ? findVaultByAddress(vaultData.underlyingAddress)
    : null;

  return (
    <div className="space-y-3">
      {underlyingVault ? (
        <p className="text-xs text-[var(--foreground-secondary)]">
          This wrapper deposits into {underlyingVault.name} ({underlyingVault.vaultSymbol}), which
          allocates to Morpho markets.
        </p>
      ) : null}

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
                  <th className={`${MARKET_CELL} ${TH} text-left`}>
                    {vaultRowsOnly ? 'Vault' : 'Market'}
                  </th>
                  <th className={`${TYPE_CELL} ${TH} text-left hidden min-[40rem]:table-cell`}>Type</th>
                  <th className={`${AMOUNT_CELL} ${TH} hidden min-[40rem]:table-cell`}>{allocatedHeader}</th>
                  <th className={`${METRIC_CELL} ${TH} text-right hidden min-[40rem]:table-cell`}>APY</th>
                  <th className={`${METRIC_CELL} ${TH} text-right hidden md:table-cell`}>Liquidity</th>
                  <th className={`${METRIC_CELL} ${TH} text-right hidden xl:table-cell`}>
                    {vaultRowsOnly ? 'Total deposits' : 'Market size'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((row) => {
                  const sizeValue = formatOptionalUsd(row.marketSizeUsd);
                  const compact = formatCompactRowSummary(row, allocatedValueType);
                  return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface)]/50"
                  >
                    <td className={MARKET_CELL}>
                      <AllocationMarketName row={row} />
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
                        title={`Liq ${formatOptionalUsd(row.liquidityUsd)} · Size ${sizeValue}`}
                      >
                        Liq {formatOptionalUsd(row.liquidityUsd)} · Size {sizeValue}
                      </p>
                      <p
                        className="mt-0.5 text-[10px] leading-snug text-[var(--foreground-muted)] hidden md:block xl:hidden"
                        title={`Size ${sizeValue}`}
                      >
                        Size {sizeValue}
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

    </div>
  );
}
