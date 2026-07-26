'use client';

import { formatPercentage } from '@/lib/formatter';
import { VaultStatPopover } from '@/components/features/vault/VaultStatPopover';

interface VaultApyInfoProps {
  /** Morpho vault apy — current gross rate before vault fees. */
  grossApy: number;
  netApy: number;
  performanceFee: number;
  managementFee: number;
}

function ApyRow({
  label,
  value,
  pill = false,
  emphasized = false,
}: {
  label: string;
  value: string;
  pill?: boolean;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span
        className={`text-xs ${emphasized ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground-secondary)]'}`}
      >
        {label}
      </span>
      {pill ? (
        <span className="text-xs font-medium text-[var(--foreground)] bg-[var(--surface)] border border-[var(--border-subtle)] rounded-md px-2 py-0.5">
          {value}
        </span>
      ) : (
        <span
          className={`text-xs ${emphasized ? 'font-semibold text-[var(--foreground)]' : 'font-medium text-[var(--foreground)]'}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

/** APY breakdown popover: gross APY → vault fees → net APY (Morpho fields). */
export function VaultApyInfo({
  grossApy,
  netApy,
  performanceFee,
  managementFee,
}: VaultApyInfoProps) {
  const grossApyLabel = formatPercentage(grossApy);
  const netApyLabel = formatPercentage(netApy);
  const performanceFeeLabel = formatPercentage(performanceFee / 100);
  const managementFeeLabel = formatPercentage(managementFee / 100);

  return (
    <VaultStatPopover ariaLabel="APY breakdown" align="start">
      <ApyRow label="APY" value={grossApyLabel} />
      <ApyRow label="Performance Fee" value={performanceFeeLabel} pill />
      <ApyRow label="Management Fee" value={managementFeeLabel} pill />
      <div className="border-t border-[var(--border-subtle)] mt-1 pt-1">
        <ApyRow label="Net APY" value={netApyLabel} emphasized />
      </div>
    </VaultStatPopover>
  );
}
