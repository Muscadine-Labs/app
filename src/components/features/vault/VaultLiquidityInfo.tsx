'use client';

import { formatAssetAmount, formatCurrency } from '@/lib/formatter';
import type { VaultLiquidityBreakdown } from '@/types/vault';
import { VaultStatPopover } from '@/components/features/vault/VaultStatPopover';

interface VaultLiquidityInfoProps {
  breakdown: VaultLiquidityBreakdown;
  assetSymbol: string;
  assetDecimals: number;
}

function LiquidityRow({
  label,
  tokenAmount,
  usdAmount,
  assetSymbol,
  assetDecimals,
  emphasized = false,
}: {
  label: string;
  tokenAmount: string;
  usdAmount: number;
  assetSymbol: string;
  assetDecimals: number;
  emphasized?: boolean;
}) {
  const tokenLabel = formatAssetAmount(
    BigInt(tokenAmount || '0'),
    assetDecimals,
    assetSymbol
  );
  const usdLabel = formatCurrency(usdAmount);

  return (
    <div
      className={`flex items-start justify-between gap-3 py-2 ${
        emphasized ? 'border-t border-[var(--border-subtle)] pt-3 mt-1' : ''
      }`}
    >
      <span
        className={`text-xs ${
          emphasized
            ? 'font-semibold text-[var(--foreground)]'
            : 'text-[var(--foreground-secondary)]'
        }`}
      >
        {label}
      </span>
      <div className="text-right shrink-0">
        <p
          className={`text-xs ${
            emphasized ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'
          }`}
        >
          {tokenLabel}
        </p>
        <p className="text-[10px] text-[var(--foreground-secondary)]">{usdLabel}</p>
      </div>
    </div>
  );
}

export function VaultLiquidityInfo({
  breakdown,
  assetSymbol,
  assetDecimals,
}: VaultLiquidityInfoProps) {
  return (
    <VaultStatPopover ariaLabel="Liquidity breakdown" align="end">
      <LiquidityRow
        label="Liquidity Adapter"
        tokenAmount={breakdown.liquidityAdapterAssets}
        usdAmount={breakdown.liquidityAdapterUsd}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
      />
      <LiquidityRow
        label="Idle Liquidity"
        tokenAmount={breakdown.idleLiquidityAssets}
        usdAmount={breakdown.idleLiquidityUsd}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
      />
      <LiquidityRow
        label="Deallocatable Liquidity"
        tokenAmount={breakdown.deallocatableLiquidityAssets}
        usdAmount={breakdown.deallocatableLiquidityUsd}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
      />
      <LiquidityRow
        label="Total Underlying Liquidity"
        tokenAmount={breakdown.totalUnderlyingLiquidityAssets}
        usdAmount={breakdown.totalUnderlyingLiquidityUsd}
        assetSymbol={assetSymbol}
        assetDecimals={assetDecimals}
        emphasized
      />
    </VaultStatPopover>
  );
}
