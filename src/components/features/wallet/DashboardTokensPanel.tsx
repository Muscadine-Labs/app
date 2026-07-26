'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useIsClient } from '@/hooks/useClientOnly';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  buildDashboardAssetHoldings,
  buildExtraWalletTokenHoldings,
  getAssetRoute,
} from '@/lib/assets';
import {
  formatCurrency,
  formatAssetAmount,
} from '@/lib/formatter';

function formatHoldingAmount(raw: bigint, decimals: number, symbol: string): string {
  return formatAssetAmount(raw, decimals, symbol);
}

function TokenGlyph({ symbol }: { symbol: string }) {
  const letter = (symbol.trim()[0] || '?').toUpperCase();
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold bg-[var(--surface-elevated)] text-[var(--foreground-secondary)] border border-[var(--border)]"
      aria-hidden
    >
      {letter}
    </div>
  );
}

export default function DashboardTokensPanel() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { tokenBalances, morphoHoldings, loading } = useWallet();
  const isMounted = useIsClient();

  const holdings = useMemo(
    () => buildDashboardAssetHoldings(tokenBalances, morphoHoldings.positions),
    [tokenBalances, morphoHoldings.positions]
  );

  const extraTokens = useMemo(
    () => buildExtraWalletTokenHoldings(tokenBalances),
    [tokenBalances]
  );

  if (!isMounted) {
    return (
      <div className="px-4 py-6">
        <Skeleton width="100%" height="6rem" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">
          Connect a wallet to see token balances.
        </p>
      </div>
    );
  }

  if (loading || morphoHoldings.isLoading) {
    return (
      <div className="px-3 sm:px-4 py-3 space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton variant="circular" width="1.75rem" height="1.75rem" />
              <Skeleton width="4rem" height="1rem" />
            </div>
            <Skeleton width="5rem" height="1rem" />
          </div>
        ))}
      </div>
    );
  }

  const hasAnyValue = holdings.length > 0 || extraTokens.length > 0;

  return (
    <ul className="divide-y divide-[var(--border)]">
      {!hasAnyValue && (
        <li className="px-4 py-3 text-center text-xs text-[var(--foreground-muted)]">
          No tokens in wallet or vaults yet.
        </li>
      )}
      {holdings.map((holding) => {
        const openAsset = () => router.push(getAssetRoute(holding.asset.slug));
        return (
          <li key={holding.asset.slug}>
            <button
              type="button"
              onClick={openAsset}
              className="w-full flex items-center justify-between gap-3 px-3 sm:px-4 py-3 text-left hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Image
                  src={holding.logo}
                  alt={holding.asset.displaySymbol}
                  width={28}
                  height={28}
                  className="rounded-full shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--foreground)] truncate">
                    {holding.asset.displaySymbol}
                  </div>
                  <div className="text-[10px] text-[var(--foreground-muted)] truncate">
                    {holding.asset.name}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">
                  {formatHoldingAmount(
                    holding.totalRaw,
                    holding.asset.decimals,
                    holding.asset.displaySymbol
                  )}
                </span>
                <span className="text-xs tabular-nums text-[var(--foreground-secondary)]">
                  {formatCurrency(holding.totalUsd)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
      {extraTokens.map((token) => (
        <li
          key={`${token.address}-${token.symbol}`}
          className="flex items-center justify-between gap-3 px-3 sm:px-4 py-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <TokenGlyph symbol={token.symbol} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--foreground)] truncate">
                {token.symbol}
              </div>
              <div className="text-[10px] text-[var(--foreground-muted)] truncate">
                Wallet
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">
              {formatHoldingAmount(token.raw, token.decimals, token.symbol)}
            </span>
            <span className="text-xs tabular-nums text-[var(--foreground-secondary)]">
              {formatCurrency(token.usd)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
