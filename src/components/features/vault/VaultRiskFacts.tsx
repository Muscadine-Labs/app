'use client';

import type { MorphoVaultData } from '@/types/vault';
import { formatDashboardTokenAmount } from '@/lib/formatter';
import { findVaultByAddress } from '@/lib/vault-utils';
import {
  describeVaultWarning,
  FEE_INCREASING_FUNCTIONS,
  formatSharePercent,
  formatTimelockDuration,
  isSevereWarning,
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

export default function VaultRiskFacts({ vaultData }: { vaultData: MorphoVaultData }) {
  const facts = buildFacts(vaultData);
  const warnings = vaultData.warnings ?? [];
  const wrapperUnderlyingName = lockedWrapperUnderlyingName(vaultData);

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
      {warnings.length > 0 ? (
        <ul className="space-y-2">
          {warnings.map((warning) => {
            const severe = isSevereWarning(warning);
            return (
              <li
                key={warning.type}
                className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm ${
                  severe
                    ? 'bg-[var(--danger-subtle)] text-[var(--foreground)]'
                    : 'bg-[var(--warning-subtle)] text-[var(--foreground)]'
                }`}
              >
                <span
                  className={`shrink-0 font-semibold ${severe ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}
                >
                  Morpho flag
                </span>
                <span>{describeVaultWarning(warning, { wrapperUnderlyingName })}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
