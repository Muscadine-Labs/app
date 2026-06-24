'use client';

import { formatPercentage } from '@/lib/formatter';
import { VaultStatPopover } from './VaultStatPopover';

interface VaultApyInfoProps {
  netApy: number;
  baseApy: number;
  performanceFee: number;
  managementFee: number;
}

function ApyRow({
  label,
  value,
  pill = false,
}: {
  label: string;
  value: string;
  pill?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-[var(--foreground-secondary)]">{label}</span>
      {pill ? (
        <span className="text-xs font-medium text-[var(--foreground)] bg-[var(--surface)] border border-[var(--border-subtle)] rounded-md px-2 py-0.5">
          {value}
        </span>
      ) : (
        <span className="text-xs font-medium text-[var(--foreground)]">{value}</span>
      )}
    </div>
  );
}

/** Morpho-style APY breakdown: net headline, base APY, performance & management fees. */
export function VaultApyInfo({
  netApy,
  baseApy,
  performanceFee,
  managementFee,
}: VaultApyInfoProps) {
  const netApyLabel = formatPercentage(netApy);
  const baseApyLabel = formatPercentage(baseApy);
  const performanceFeeLabel = formatPercentage(performanceFee / 100);
  const managementFeeLabel = formatPercentage(managementFee / 100);
  const showBaseApy = Math.abs(netApy - baseApy) > 0.00005;

  return (
    <VaultStatPopover ariaLabel="APY breakdown" align="start">
      <div className="flex items-center justify-between gap-3 pb-2 mb-1 border-b border-[var(--border-subtle)]">
        <span className="text-xs font-semibold text-[var(--foreground)]">Net APY</span>
        <span className="text-xs font-semibold text-[var(--foreground)]">{netApyLabel}</span>
      </div>
      {showBaseApy && <ApyRow label="Base APY" value={baseApyLabel} />}
      <ApyRow label="Performance Fee" value={performanceFeeLabel} pill />
      <ApyRow label="Management Fee" value={managementFeeLabel} pill />
    </VaultStatPopover>
  );
}
