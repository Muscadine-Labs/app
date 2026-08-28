'use client';

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useWallet } from '@/contexts/WalletContext';
import { Skeleton } from '@/components/ui/Skeleton';
import { buildStockHoldings } from '@/lib/assets';
import DashboardAssetTable, {
  type DashboardAssetRow,
} from './DashboardAssetTable';

/**
 * Base stock / equity wrappers held in the wallet (xStocks, etc.).
 * Only lists tokens currently held — nothing speculative.
 */
export default function DashboardStocksPanel() {
  const { isConnected } = useAccount();
  const { tokenBalances, loading } = useWallet();

  const holdings = useMemo(
    () => buildStockHoldings(tokenBalances),
    [tokenBalances]
  );

  const rows: DashboardAssetRow[] = useMemo(
    () =>
      holdings.map((holding) => ({
        key: `${holding.address}-${holding.symbol}`,
        name: holding.name,
        symbol: holding.symbol,
        icon: (
          <div
            className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold bg-[var(--surface-elevated)] text-[var(--foreground-secondary)] border border-[var(--border)]"
            aria-hidden
          >
            {(holding.symbol.trim()[0] || '?').toUpperCase()}
          </div>
        ),
        positionRaw: holding.raw.toString(),
        positionDecimals: holding.decimals,
        positionSymbol: holding.symbol,
        positionUsd: holding.usd,
        earnedRaw: '0',
        earnedDecimals: holding.decimals,
        earnedSymbol: holding.symbol,
        earnedUsd: 0,
      })),
    [holdings]
  );

  if (!isConnected) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">
          Connect a wallet to see stock holdings.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 py-8">
        <Skeleton width="100%" height="8rem" />
      </div>
    );
  }

  return (
    <DashboardAssetTable
      nameHeader="Asset"
      rows={rows}
      emptyMessage="No stocks yet"
    />
  );
}
