'use client';

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useIsClient } from '@/hooks/useClientOnly';
import { useWallet } from '@/contexts/WalletContext';
import { Skeleton } from '@/components/ui/Skeleton';
import { buildStockHoldings } from '@/lib/assets';
import {
  formatAssetAmount,
  formatCurrency,
} from '@/lib/formatter';

/**
 * Base stock / equity wrappers held in the wallet (xStocks, etc.).
 * Only lists tokens currently held — nothing speculative.
 */
export default function DashboardStocksPanel() {
  const { isConnected } = useAccount();
  const { tokenBalances, loading } = useWallet();
  const isMounted = useIsClient();

  const holdings = useMemo(
    () => buildStockHoldings(tokenBalances),
    [tokenBalances]
  );

  if (!isMounted) {
    return (
      <div className="px-4 py-6">
        <Skeleton width="100%" height="4rem" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">
          Connect a wallet to see stock holdings.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-3 sm:px-4 py-3 space-y-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-3">
            <Skeleton width="4rem" height="1rem" />
            <Skeleton width="5rem" height="1rem" />
          </div>
        ))}
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">No stocks yet</p>
        <p className="text-xs text-[var(--foreground-muted)] mt-1">
          Tokenized stocks in your wallet (e.g. xStocks) will show here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border)]">
      {holdings.map((holding) => (
        <li
          key={`${holding.address}-${holding.symbol}`}
          className="flex items-center justify-between gap-3 px-3 sm:px-4 py-3"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--foreground)] truncate">
              {holding.symbol}
            </div>
            <div className="text-[10px] text-[var(--foreground-muted)]">Stock</div>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">
              {formatAssetAmount(holding.raw, holding.decimals, holding.symbol)}
            </span>
            <span className="text-xs tabular-nums text-[var(--foreground-secondary)]">
              {formatCurrency(holding.usd)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
