'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { MorphoVaultData } from '@/types/vault';
import type { VaultCapData, VaultCapRow } from '@/lib/vault-v2-caps';
import CopiableAddress from '@/components/common/CopiableAddress';
import { formatDashboardTokenAmount } from '@/lib/formatter';
import { findVaultByAddress, getVaultRoute } from '@/lib/vault-utils';
import { getPairedVaultAddress } from '@/lib/vaults';
import { getMorphoVaultUrl } from '@/lib/liquidity-utils';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { groupTimelocks, maxRateToAnnualPercent } from '@/lib/vault-details';
import { Skeleton } from '@/components/ui/Skeleton';

/** uint128 max and above: the cap does not limit anything. */
const UNLIMITED_CAP = (BigInt(1) << BigInt(127));
const WAD = BigInt(10) ** BigInt(18);

function basescanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

function Disclosure({
  title,
  meta,
  onOpen,
  children,
}: {
  title: string;
  meta?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 sm:px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
        <span className="flex min-w-0 items-center gap-3">
          {meta ? (
            <span className="truncate text-xs text-[var(--foreground-muted)]">{meta}</span>
          ) : null}
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
      <div className="px-3 sm:px-4 pb-4 text-sm min-w-0">{children}</div>
    </details>
  );
}

function AddressLine({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CopiableAddress address={address} className="!text-xs sm:!text-sm tabular-nums" />
      <a
        href={basescanAddressUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
      >
        Basescan
      </a>
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-1 py-2 border-b border-[var(--border-subtle)] last:border-b-0">
      <dt className="text-xs sm:text-sm text-[var(--foreground-secondary)]">{label}</dt>
      <dd className="min-w-0 space-y-1 text-[var(--foreground)]">{children}</dd>
    </div>
  );
}

function AddressList({ addresses }: { addresses: readonly string[] }) {
  if (addresses.length === 0) return <span className="text-[var(--foreground-muted)]">None</span>;
  return (
    <ul className="space-y-1">
      {addresses.map((address) => (
        <li key={address}>
          <AddressLine address={address} />
        </li>
      ))}
    </ul>
  );
}

function formatCapAmount(raw: string, decimals: number, symbol: string): string {
  try {
    if (BigInt(raw) >= UNLIMITED_CAP) return 'No limit';
  } catch {
    return '—';
  }
  return formatDashboardTokenAmount(raw, decimals, symbol);
}

function formatRelativeCap(wad: string): string {
  try {
    const value = BigInt(wad);
    if (value >= WAD) return 'No limit';
    return `${(Number((value * BigInt(10_000)) / WAD) / 100).toString()}%`;
  } catch {
    return '—';
  }
}

function formatCapUsed(row: VaultCapRow): string {
  try {
    const cap = BigInt(row.absoluteCapRaw);
    if (cap === BigInt(0) || cap >= UNLIMITED_CAP) return '—';
    const used = Number((BigInt(row.allocationRaw) * BigInt(1_000)) / cap) / 10;
    return `${used}%`;
  } catch {
    return '—';
  }
}

const CAP_KIND_LABEL: Record<VaultCapRow['kind'], string> = {
  market: 'Market',
  collateral: 'Collateral',
  adapter: 'Adapter',
};

async function fetchCaps(address: string, chainId: number): Promise<VaultCapData> {
  const response = await fetch(`/api/vault/v2/${address}/caps?chainId=${chainId}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load caps');
  return data as VaultCapData;
}

function CapsTable({ vaultData, enabled }: { vaultData: MorphoVaultData; enabled: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ['vault-caps', vaultData.address.toLowerCase(), vaultData.chainId],
    enabled,
    staleTime: MORPHO_GRAPHQL_REVALIDATE_SECONDS * 1000,
    retry: 1,
    queryFn: () => fetchCaps(vaultData.address, vaultData.chainId),
  });

  if (!enabled || isPending) {
    return (
      <div className="space-y-2">
        <Skeleton width="100%" height="2rem" />
        <Skeleton width="100%" height="2rem" />
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-[var(--foreground-muted)]">Caps could not be loaded. Try again in a moment.</p>;
  }
  if (data.caps.length === 0) {
    return <p className="text-[var(--foreground-muted)]">No caps are set.</p>;
  }

  const symbol = data.assetSymbol || vaultData.symbol;
  // Caps on markets the vault has nothing in are room to grow, not current exposure.
  const inUse = data.caps.filter((row) => row.allocationRaw !== '0');
  const rows = showAll || inUse.length === 0 ? data.caps : inUse;
  const hiddenCount = data.caps.length - inUse.length;
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--foreground-secondary)]">
        The most this vault may put in each market, collateral token or adapter. Every deposit and
        reallocation must stay inside all of them.
      </p>
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-[34rem] text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--foreground-secondary)]">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 px-3 font-medium text-right">Allocated</th>
              <th className="py-2 px-3 font-medium text-right">Cap</th>
              <th className="py-2 px-3 font-medium text-right">Relative cap</th>
              <th className="py-2 pl-3 font-medium text-right">Used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className="font-medium text-[var(--foreground)]">{row.label}</span>
                  {row.lltv !== null ? (
                    <span className="ml-1.5 rounded-full bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] text-[var(--foreground-secondary)] tabular-nums">
                      {Math.round(row.lltv * 1000) / 10}%
                    </span>
                  ) : null}
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--foreground-muted)]">
                    {CAP_KIND_LABEL[row.kind]}
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                  {formatDashboardTokenAmount(row.allocationRaw, data.assetDecimals, symbol)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                  {formatCapAmount(row.absoluteCapRaw, data.assetDecimals, symbol)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                  {formatRelativeCap(row.relativeCapWad)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap text-[var(--foreground-secondary)]">
                  {formatCapUsed(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && inUse.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline cursor-pointer"
        >
          {showAll
            ? 'Show only caps in use'
            : `Show all ${data.caps.length} caps (${hiddenCount} with nothing allocated)`}
        </button>
      ) : null}
    </div>
  );
}

export default function VaultDetails({ vaultData }: { vaultData: MorphoVaultData }) {
  const [capsOpened, setCapsOpened] = useState(false);
  const allocators = vaultData.allocators ?? [];
  const sentinels = vaultData.sentinels ?? [];
  const timelocks = vaultData.timelocks ?? [];
  const timelockGroups = groupTimelocks(timelocks);
  const maxRatePercent = maxRateToAnnualPercent(vaultData.maxRate);

  const pairAddress = getPairedVaultAddress(vaultData.address);
  const pairVault = pairAddress ? findVaultByAddress(pairAddress) : null;
  const pairLabel = vaultData.kind === 'wrapper' ? 'Underlying vault' : 'Fee wrapper';

  const roleCount = [
    vaultData.ownerAddress ? 'owner' : null,
    vaultData.curatorAddress ? 'curator' : null,
    allocators.length ? `${allocators.length} allocator${allocators.length === 1 ? '' : 's'}` : null,
    sentinels.length ? `${sentinels.length} sentinel${sentinels.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <Disclosure title="Roles" meta={roleCount.join(', ')}>
        <dl>
          <DetailRow label="Owner">
            {vaultData.ownerAddress ? <AddressLine address={vaultData.ownerAddress} /> : <span className="text-[var(--foreground-muted)]">—</span>}
            <p className="text-xs text-[var(--foreground-muted)]">Appoints the curator and sentinels. Does not move funds.</p>
          </DetailRow>
          <DetailRow label="Curator">
            {vaultData.curatorAddress ? <AddressLine address={vaultData.curatorAddress} /> : <span className="text-[var(--foreground-muted)]">—</span>}
            <p className="text-xs text-[var(--foreground-muted)]">Muscadine. Chooses the markets and caps; adding risk waits out the timelock.</p>
          </DetailRow>
          <DetailRow label="Allocators">
            <AddressList addresses={allocators} />
            <p className="text-xs text-[var(--foreground-muted)]">Move funds between allowed markets, inside the caps.</p>
          </DetailRow>
          <DetailRow label="Sentinels">
            <AddressList addresses={sentinels} />
            <p className="text-xs text-[var(--foreground-muted)]">Can pull funds back, lower caps or cancel a pending change.</p>
          </DetailRow>
        </dl>
      </Disclosure>

      <Disclosure
        title="Timelocks"
        meta={timelocks.length ? `${timelocks.length} functions` : undefined}
      >
        {timelockGroups.length === 0 ? (
          <p className="text-[var(--foreground-muted)]">Timelocks could not be loaded.</p>
        ) : (
          <>
            <p className="pb-1 text-xs text-[var(--foreground-secondary)]">
              How long a change must wait after it is proposed. Abdicated functions can never be called again.
            </p>
            <dl>
              {timelockGroups.map((group) => (
                <DetailRow key={group.label} label={group.label}>
                  <p className="font-mono text-xs leading-relaxed break-words text-[var(--foreground-secondary)]">
                    {group.functions.join(', ')}
                  </p>
                </DetailRow>
              ))}
            </dl>
          </>
        )}
      </Disclosure>

      <Disclosure title="Caps" meta="Per market, collateral and adapter" onOpen={() => setCapsOpened(true)}>
        <CapsTable vaultData={vaultData} enabled={capsOpened} />
      </Disclosure>

      <Disclosure title="Contracts and limits">
        <dl>
          <DetailRow label="Vault">
            <AddressLine address={vaultData.address} />
          </DetailRow>
          {pairVault ? (
            <DetailRow label={pairLabel}>
              <Link
                href={getVaultRoute(pairVault.address)}
                className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
              >
                {pairVault.name}
              </Link>
              <div>
                <AddressLine address={pairVault.address} />
              </div>
            </DetailRow>
          ) : null}
          {vaultData.liquidityAdapterAddress ? (
            <DetailRow label="Liquidity adapter">
              <AddressLine address={vaultData.liquidityAdapterAddress} />
              <p className="text-xs text-[var(--foreground-muted)]">Where new deposits go first, and where instant withdrawals come from.</p>
            </DetailRow>
          ) : null}
          {maxRatePercent !== null ? (
            <DetailRow label="Max rate">
              <span className="tabular-nums">{maxRatePercent.toLocaleString('en-US')}% a year</span>
              <p className="text-xs text-[var(--foreground-muted)]">The fastest the share price is allowed to rise.</p>
            </DetailRow>
          ) : null}
          <DetailRow label="Links">
            <span className="inline-flex flex-wrap gap-3">
              <a
                href={getMorphoVaultUrl(vaultData.chainId, vaultData.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
              >
                Morpho
              </a>
              <a
                href={basescanAddressUrl(vaultData.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
              >
                Basescan
              </a>
            </span>
          </DetailRow>
        </dl>
      </Disclosure>
    </div>
  );
}
