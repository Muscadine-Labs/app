'use client';

import { useQuery } from '@tanstack/react-query';
import type { MorphoVaultData } from '@/types/vault';
import { formatDashboardTokenAmount } from '@/lib/formatter';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { useUnixTimestamp } from '@/hooks/useClientOnly';
import type { PendingChangeDirection, VaultPendingChange } from '@/lib/vault-v2-pending';
import { findVaultByAddress } from '@/lib/vault-utils';
import {
  FEE_INCREASING_FUNCTIONS,
  formatSharePercent,
  formatTimelockDuration,
  formatTimeUntil,
  RISK_INCREASING_FUNCTIONS,
  shortestGuard,
} from '@/lib/vault-details';

interface Fact {
  key: string;
  label: string;
  value: string;
  body: string;
}

function toBigInt(value: string | undefined | null): bigint {
  try {
    return value ? BigInt(value) : BigInt(0);
  } catch {
    return BigInt(0);
  }
}

function formatPercentValue(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

/**
 * Name of the vault a fee wrapper is locked to: a wrapper whose `addAdapter` is
 * abdicated can only ever deposit into its underlying vault.
 */
function lockedWrapperUnderlyingName(vaultData: MorphoVaultData): string | null {
  if (vaultData.kind !== 'wrapper' || !vaultData.underlyingAddress) return null;
  if (shortestGuard(vaultData.timelocks ?? [], ['addAdapter']).kind !== 'abdicated') return null;
  return findVaultByAddress(vaultData.underlyingAddress)?.name ?? 'its underlying vault';
}

function buildFacts(vaultData: MorphoVaultData): Fact[] {
  const decimals = vaultData.assetDecimals || 18;
  const symbol = vaultData.symbol;
  const timelocks = vaultData.timelocks ?? [];
  const isWrapper = vaultData.kind === 'wrapper';
  const facts: Fact[] = [];

  const instantRaw = toBigInt(
    vaultData.liquidityBreakdown?.instantLiquidityAssets ?? vaultData.liquidityAssets
  );
  const deallocatableRaw = toBigInt(vaultData.liquidityBreakdown?.deallocatableLiquidityAssets);
  const totalAssetsRaw = toBigInt(vaultData.totalAssets);
  const instantShare =
    totalAssetsRaw > BigInt(0) ? Number((instantRaw * BigInt(10_000)) / totalAssetsRaw) / 10_000 : 0;
  const instantLabel = formatDashboardTokenAmount(instantRaw.toString(), decimals, symbol);
  let withdrawBody: string;
  if (isWrapper) {
    withdrawBody =
      'This wrapper has no force withdraw. A larger withdrawal waits until borrowers repay or new deposits arrive.';
  } else if (deallocatableRaw > BigInt(0)) {
    const total = formatDashboardTokenAmount((instantRaw + deallocatableRaw).toString(), decimals, symbol);
    withdrawBody = `Up to ${total} with a force withdraw, which pulls funds out of markets for a small penalty shown before you sign.`;
  } else {
    withdrawBody = 'A larger withdrawal waits until borrowers repay or new deposits arrive.';
  }
  facts.push({
    key: 'withdraw',
    label: 'Withdraw now',
    value: totalAssetsRaw > BigInt(0) ? `${instantLabel} · ${formatSharePercent(instantShare)} of deposits` : instantLabel,
    body: withdrawBody,
  });

  const riskGuard = shortestGuard(timelocks, RISK_INCREASING_FUNCTIONS);
  const lockedUnderlying = lockedWrapperUnderlyingName(vaultData);
  if (lockedUnderlying) {
    // Raising a locked wrapper's cap only lets more flow into the same underlying vault.
    facts.push({
      key: 'risk',
      label: 'New risk',
      value: `Set by ${lockedUnderlying}`,
      body: `This wrapper can only deposit into ${lockedUnderlying}. Adding a market there waits out that vault’s own timelock.`,
    });
  } else if (riskGuard.kind === 'delay') {
    facts.push(
      riskGuard.seconds > 0
        ? {
            key: 'risk',
            label: 'New risk waits',
            value: formatTimelockDuration(riskGuard.seconds),
            body: `Adding a market or raising a cap is public for ${formatTimelockDuration(riskGuard.seconds)} before it can take effect, so you can withdraw first.`,
          }
        : {
            key: 'risk',
            label: 'New risk waits',
            value: 'No delay',
            body: 'Adding a market or raising a cap can take effect right away.',
          }
    );
  } else if (riskGuard.kind === 'abdicated') {
    facts.push({
      key: 'risk',
      label: 'New risk',
      value: 'Locked',
      body: 'The ability to add markets or raise caps has been given up for good.',
    });
  }

  const feeGuard = shortestGuard(timelocks, FEE_INCREASING_FUNCTIONS);
  const feeBody =
    feeGuard.kind === 'delay'
      ? feeGuard.seconds > 0
        ? `A fee increase waits ${formatTimelockDuration(feeGuard.seconds)}.`
        : 'Fees can change without notice.'
      : feeGuard.kind === 'abdicated'
        ? 'Fees can never be changed.'
        : 'As set on the vault contract.';
  facts.push({
    key: 'fees',
    label: 'Fees',
    value: `${formatPercentValue(vaultData.performanceFee ?? 0)} performance · ${formatPercentValue(vaultData.managementFee ?? 0)} management`,
    body: feeBody,
  });

  const sentinelCount = vaultData.sentinels?.length ?? 0;
  facts.push({
    key: 'sentinels',
    label: 'Emergency controls',
    value: sentinelCount === 0 ? 'No sentinels' : `${sentinelCount} sentinel${sentinelCount === 1 ? '' : 's'}`,
    body:
      sentinelCount === 0
        ? 'No one is assigned to pull funds back or cancel a pending change.'
        : 'They can pull funds back to the vault, lower caps or cancel a pending change. They cannot add risk.',
  });

  return facts;
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

export default function VaultRiskFacts({ vaultData }: { vaultData: MorphoVaultData }) {
  const facts = buildFacts(vaultData);

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {facts.map((fact) => (
          <div
            key={fact.key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 sm:p-4 space-y-1 min-w-0"
          >
            <dt className="text-xs text-[var(--foreground-secondary)]">{fact.label}</dt>
            <dd className="space-y-1">
              <p className="text-sm sm:text-base font-semibold text-[var(--foreground)] tabular-nums">
                {fact.value}
              </p>
              <p className="text-xs sm:text-sm text-[var(--foreground-secondary)] leading-relaxed">{fact.body}</p>
            </dd>
          </div>
        ))}
      </dl>
      <PendingChanges vaultData={vaultData} />
    </div>
  );
}
