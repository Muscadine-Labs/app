'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MorphoVaultData } from '@/types/vault';
import type { VaultCapData, VaultCapRow } from '@/lib/vault-v2-caps';
import CopiableAddress from '@/components/common/CopiableAddress';
import { formatDashboardTokenAmount, formatPercentage } from '@/lib/formatter';
import { getMorphoVaultUrl } from '@/lib/liquidity-utils';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { groupTimelocks, maxRateToAnnualPercent } from '@/lib/vault-details';
import { Skeleton } from '@/components/ui/Skeleton';
import { VaultStatPopover } from '@/components/features/vault/VaultStatPopover';

/** uint128 max and above: the cap does not limit anything. */
const UNLIMITED_CAP = (BigInt(1) << BigInt(127));
const WAD = BigInt(10) ** BigInt(18);

function basescanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

function DetailInfo({ label, text }: { label: string; text: string }) {
  return (
    <span
      className="inline-flex"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <VaultStatPopover ariaLabel={label}>
        <p className="py-1 text-xs leading-relaxed text-[var(--foreground-secondary)]">{text}</p>
      </VaultStatPopover>
    </span>
  );
}

function Disclosure({
  title,
  meta,
  info,
  onOpen,
  children,
}: {
  title: string;
  meta?: string;
  info?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <details
      className="group/disclosure rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 sm:px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
          {title}
          {info ? <DetailInfo label={title} text={info} /> : null}
        </span>
        <span className="flex min-w-0 items-center gap-3">
          {meta ? (
            <span className="truncate text-xs text-[var(--foreground-muted)]">{meta}</span>
          ) : null}
          <svg
            className="h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-open/disclosure:rotate-180"
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

function DetailRow({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-1 py-2 border-b border-[var(--border-subtle)] last:border-b-0">
      <dt className="flex items-center gap-1.5 text-xs sm:text-sm text-[var(--foreground-secondary)]">
        <span>{label}</span>
        {info ? <DetailInfo label={label} text={info} /> : null}
      </dt>
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

const CAP_SECTIONS: { kind: VaultCapRow['kind']; title: string }[] = [
  { kind: 'market', title: 'Markets' },
  { kind: 'collateral', title: 'Tokens' },
  { kind: 'adapter', title: 'Adapters' },
];

function formatCapMarketRate(row: VaultCapRow): string | null {
  if (row.kind !== 'market' || !row.rateType) return null;
  const kind = row.rateType === 'fixed' ? 'Fixed' : 'Variable';
  if (row.lltv == null) return kind;
  return `${kind} (${(row.lltv * 100).toFixed(1)}%)`;
}

async function fetchCaps(address: string, chainId: number): Promise<VaultCapData> {
  const response = await fetch(`/api/vault/v2/${address}/caps?chainId=${chainId}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load caps');
  return data as VaultCapData;
}

function CapChevron() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-open/cap:rotate-180"
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
  );
}

function CapName({ row }: { row: VaultCapRow }) {
  const rate = formatCapMarketRate(row);
  return (
    <>
      {row.href ? (
        <a
          href={row.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
        >
          {row.label}
        </a>
      ) : (
        <span className="font-medium text-[var(--foreground)]">{row.label}</span>
      )}
      {rate ? (
        <span className="ml-1.5 whitespace-nowrap rounded-full bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] text-[var(--foreground-secondary)] tabular-nums">
          {rate}
        </span>
      ) : null}
    </>
  );
}

function CapSectionTable({
  rows,
  symbol,
  decimals,
}: {
  rows: VaultCapRow[];
  symbol: string;
  decimals: number;
}) {
  return (
    <div className="@container pb-2">
      <ul className="@min-[34rem]:hidden space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]/40 px-3 py-2.5 space-y-2"
          >
            <div className="text-xs sm:text-sm">
              <CapName row={row} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div>
                <dt className="text-[var(--foreground-muted)]">Allocated</dt>
                <dd className="tabular-nums">{formatDashboardTokenAmount(row.allocationRaw, decimals, symbol)}</dd>
              </div>
              <div>
                <dt className="text-[var(--foreground-muted)]">Cap</dt>
                <dd className="tabular-nums">{formatCapAmount(row.absoluteCapRaw, decimals, symbol)}</dd>
              </div>
              <div>
                <dt className="text-[var(--foreground-muted)]">Relative cap</dt>
                <dd className="tabular-nums">{formatRelativeCap(row.relativeCapWad)}</dd>
              </div>
              <div>
                <dt className="text-[var(--foreground-muted)]">Used</dt>
                <dd className="tabular-nums">{formatCapUsed(row)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <table className="hidden @min-[34rem]:table w-full text-xs sm:text-sm">
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
                <CapName row={row} />
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {formatDashboardTokenAmount(row.allocationRaw, decimals, symbol)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {formatCapAmount(row.absoluteCapRaw, decimals, symbol)}
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
  );
}

function CapsTable({ vaultData, enabled }: { vaultData: MorphoVaultData; enabled: boolean }) {
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
  const decimals = data.assetDecimals;
  return (
    <div>
      {CAP_SECTIONS.map((section) => {
        const sectionRows = data.caps.filter((row) => row.kind === section.kind);
        if (sectionRows.length === 0) return null;
        return (
          <details key={section.kind} className="group/cap border-b border-[var(--border-subtle)] last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-secondary)]">
                {section.title}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-[var(--foreground-muted)]">{sectionRows.length}</span>
                <CapChevron />
              </span>
            </summary>
            <CapSectionTable rows={sectionRows} symbol={symbol} decimals={decimals} />
          </details>
        );
      })}
    </div>
  );
}

const LIQUIDITY_ADAPTER_LABELS: Record<string, string> = {
  MorphoMarketV1Adapter: 'Morpho Blue adapter',
};

export default function VaultDetails({ vaultData }: { vaultData: MorphoVaultData }) {
  const [capsOpened, setCapsOpened] = useState(false);
  const allocators = vaultData.allocators ?? [];
  const sentinels = vaultData.sentinels ?? [];
  const timelockGroups = groupTimelocks(vaultData.timelocks ?? []);
  const timelockCount = timelockGroups.reduce((count, group) => count + group.functions.length, 0);
  const maxRatePercent = maxRateToAnnualPercent(vaultData.maxRate);
  const liquidityAdapterLabel = vaultData.liquidityAdapterType
    ? LIQUIDITY_ADAPTER_LABELS[vaultData.liquidityAdapterType]
    : undefined;

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
          <DetailRow label="Owner" info="Appoints the curator and sentinels. Does not move funds.">
            {vaultData.ownerAddress ? <AddressLine address={vaultData.ownerAddress} /> : <span className="text-[var(--foreground-muted)]">—</span>}
          </DetailRow>
          <DetailRow label="Curator" info="Muscadine. Chooses the markets and caps; adding risk waits out the timelock.">
            {vaultData.curatorAddress ? <AddressLine address={vaultData.curatorAddress} /> : <span className="text-[var(--foreground-muted)]">—</span>}
          </DetailRow>
          <DetailRow label="Allocators" info="Move funds between allowed markets, inside the caps.">
            <AddressList addresses={allocators} />
          </DetailRow>
          <DetailRow label="Sentinels" info="Can pull funds back, lower caps or cancel a pending change.">
            <AddressList addresses={sentinels} />
          </DetailRow>
        </dl>
      </Disclosure>

      <Disclosure
        title="Timelocks"
        meta={timelockCount ? `${timelockCount} functions` : undefined}
        info="How long a change must wait after it is proposed. Abdicated functions can never be called again."
      >
        {timelockGroups.length === 0 ? (
          <p className="text-[var(--foreground-muted)]">Timelocks could not be loaded.</p>
        ) : (
          <dl>
            {timelockGroups.map((group) => (
              <DetailRow key={group.label} label={group.label}>
                <p className="font-mono text-xs leading-relaxed break-words text-[var(--foreground-secondary)]">
                  {group.functions.join(', ')}
                </p>
              </DetailRow>
            ))}
          </dl>
        )}
      </Disclosure>

      <Disclosure
        title="Caps"
        meta="Markets, tokens and adapters"
        info="The most this vault may put in each market, collateral token or adapter. Every deposit and reallocation must stay inside all of them."
        onOpen={() => setCapsOpened(true)}
      >
        <CapsTable vaultData={vaultData} enabled={capsOpened} />
      </Disclosure>

      <Disclosure title="Contracts and limits">
        <dl>
          <DetailRow label="Vault">
            <AddressLine address={vaultData.address} />
          </DetailRow>
          {vaultData.liquidityAdapterAddress ? (
            <DetailRow
              label="Liquidity adapter"
              info="Where new deposits go first, and where instant withdrawals come from."
            >
              {liquidityAdapterLabel ? (
                <span className="font-medium text-[var(--foreground)]">{liquidityAdapterLabel}</span>
              ) : null}
              <div>
                <AddressLine address={vaultData.liquidityAdapterAddress} />
              </div>
            </DetailRow>
          ) : null}
          <DetailRow label="Performance fee" info="Taken from the yield, not from the deposit.">
            <span className="tabular-nums">{formatPercentage((vaultData.performanceFee ?? 0) / 100)}</span>
          </DetailRow>
          <DetailRow label="Management fee" info="Charged on assets over the year.">
            <span className="tabular-nums">{formatPercentage((vaultData.managementFee ?? 0) / 100)}</span>
          </DetailRow>
          {maxRatePercent !== null ? (
            <DetailRow label="Max rate" info="The fastest the share price is allowed to rise.">
              <span className="tabular-nums">{maxRatePercent.toLocaleString('en-US')}% a year</span>
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
                Morpho Vault
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
