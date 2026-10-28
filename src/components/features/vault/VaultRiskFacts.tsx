'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MorphoVaultData } from '@/types/vault';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { useUnixTimestamp } from '@/hooks/useClientOnly';
import type { PendingChangeDirection, VaultPendingChange } from '@/lib/vault-v2-pending';
import { findVaultByAddress } from '@/lib/vault-utils';
import { getMorphoVaultUrl } from '@/lib/liquidity-utils';
import { formatTimeUntil } from '@/lib/vault-details';

const RISK_FRAMEWORK_URL = 'https://muscadine.xyz/risk';
const MORPHO_DISCLAIMER_URL = 'https://morpho.org/disclaimers';

const STRATEGY_TEXT: Record<'prime' | 'frontier', string> = {
  prime:
    'Prime lends only against blue-chip collateral, such as BTC and ETH and their wrapped or staked versions, in deep markets with conservative loan-to-value limits. It aims for steady yield over the highest yield.',
  frontier:
    'Frontier aims for higher yield. It lends against a wider set of crypto assets and tokenized stocks, with lower loan-to-value limits to offset more volatile collateral.',
};

/** What the curator checks before a market can hold funds. */
const SCREENING: ReadonlyArray<{ label: string; body: string }> = [
  {
    label: 'Collateral',
    body: 'What backs each loan: a native asset, a wrapped or staked version of one, or a tokenized stock, and how it can be redeemed.',
  },
  {
    label: 'Market liquidity',
    body: 'How much can be withdrawn from the market and how much of it is borrowed, so exits stay possible. Collateral also needs secondary-market liquidity, so it can be sold if a loan is liquidated.',
  },
  {
    label: 'Oracle and LTV',
    body: 'Where the price comes from and how often it updates, and how much can be borrowed against the collateral before liquidation.',
  },
];

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline"
    >
      {children}
    </a>
  );
}

const DIRECTION_MARK: Record<PendingChangeDirection, { symbol: string; label: string; className: string }> = {
  add: { symbol: '+', label: 'Adds', className: 'text-[var(--warning)] border-[var(--warning)]' },
  remove: { symbol: '−', label: 'Removes', className: 'text-[var(--foreground-secondary)] border-[var(--border-strong)]' },
  change: { symbol: '•', label: 'Changes', className: 'text-[var(--foreground-secondary)] border-[var(--border-strong)]' },
};

async function fetchPendingChanges(address: string, chainId: number): Promise<VaultPendingChange[]> {
  const response = await fetch(`/api/vault/v2/${address}/pending?chainId=${chainId}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load pending changes');
  return Array.isArray(data.pending) ? data.pending : [];
}

/**
 * Curator changes waiting out their timelock. Hidden when there are none (or the read
 * fails): it is a heads-up, not a status.
 */
function PendingChanges({ vaultData }: { vaultData: MorphoVaultData }) {
  const { data: pending } = useQuery({
    queryKey: ['vault-pending', vaultData.address.toLowerCase(), vaultData.chainId],
    staleTime: MORPHO_GRAPHQL_REVALIDATE_SECONDS * 1000,
    retry: 1,
    queryFn: () => fetchPendingChanges(vaultData.address, vaultData.chainId),
  });
  const now = useUnixTimestamp();
  if (!pending || pending.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--warning-subtle)] px-3 py-2.5 sm:px-4 space-y-2">
      <p className="text-xs sm:text-sm font-semibold text-[var(--foreground)]">
        Pending change{pending.length === 1 ? '' : 's'}
        <span className="ml-1.5 font-normal text-[var(--foreground-secondary)]">
          Proposed by the curator, public until the timelock ends
        </span>
      </p>
      <ul className="space-y-1.5">
        {pending.map((change) => {
          const mark = DIRECTION_MARK[change.direction];
          return (
            <li key={change.id} className="flex items-start gap-2 text-xs sm:text-sm">
              <span
                className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold leading-none ${mark.className}`}
                aria-label={mark.label}
                title={mark.label}
              >
                {mark.symbol}
              </span>
              <span className="min-w-0 text-[var(--foreground)]">
                {change.title}
                <span className="text-[var(--foreground-secondary)]"> · {formatTimeUntil(change.validAt, now)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Risk in plain words: the strategy, how markets are screened, and pending curator changes. */
export default function VaultRiskFacts({ vaultData }: { vaultData: MorphoVaultData }) {
  const underlying =
    vaultData.kind === 'wrapper' && vaultData.underlyingAddress
      ? findVaultByAddress(vaultData.underlyingAddress)
      : null;
  const strategy = vaultData.strategy ?? underlying?.strategy;
  // A wrapper's markets are on its underlying vault's Morpho page.
  const marketsVaultAddress = underlying?.address ?? vaultData.address;
  const marketsVaultName = underlying?.name ?? vaultData.name;
  const marketsUrl = `${getMorphoVaultUrl(vaultData.chainId, marketsVaultAddress, marketsVaultName)}#allocation`;

  return (
    <div className="space-y-3">
      <div className="space-y-2 text-sm text-[var(--foreground-secondary)] leading-relaxed max-w-3xl">
        {strategy ? <p>{STRATEGY_TEXT[strategy]}</p> : null}
        {underlying ? (
          <p>
            This is a fee wrapper: deposits go into {underlying.name}. It has no force withdraw, so a
            large withdrawal may have to wait until that vault has liquidity.
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 sm:p-4 space-y-2">
        <p className="text-xs font-medium text-[var(--foreground-secondary)]">
          Every market is screened on
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SCREENING.map((item) => (
            <div key={item.label} className="min-w-0 space-y-0.5">
              <dt className="text-sm font-semibold text-[var(--foreground)]">{item.label}</dt>
              <dd className="text-xs sm:text-sm text-[var(--foreground-secondary)] leading-relaxed">
                {item.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <PendingChanges vaultData={vaultData} />

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm">
        <ExternalLink href={marketsUrl}>
          View markets on Morpho
        </ExternalLink>
        <ExternalLink href={RISK_FRAMEWORK_URL}>Risk framework</ExternalLink>
        <ExternalLink href={MORPHO_DISCLAIMER_URL}>Morpho’s disclaimer</ExternalLink>
      </p>
    </div>
  );
}
