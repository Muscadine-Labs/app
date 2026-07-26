'use client';

import { useState, type Ref } from 'react';
import { useAccount } from 'wagmi';
import { useWallet } from '@/contexts/WalletContext';
import { useIsClient } from '@/hooks/useClientOnly';
import { useWalletDisplayName } from '@/hooks/useWalletDisplayName';
import { useToast } from '@/contexts/ToastContext';
import { Skeleton } from '@/components/ui/Skeleton';
import { logger } from '@/lib/logger';

type WalletOverviewProps = {
  /** Intrinsic-width row used to decide full-width vs half-column layout. */
  measureRef?: Ref<HTMLDivElement>;
};

export default function WalletOverview({ measureRef }: WalletOverviewProps) {
  const { address, isConnected } = useAccount();
  const {
    totalUsdValue,
    liquidUsdValue,
    morphoUsdValue,
    morphoHoldings,
    loading: walletLoading,
  } = useWallet();
  const isMounted = useIsClient();
  const { displayName, primaryName, isLoading: nameLoading } = useWalletDisplayName(
    address
  );
  const { showToast, error: showErrorToast } = useToast();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      showToast(
        primaryName ? `Copied ${primaryName}` : 'Address copied',
        'neutral',
        2000
      );
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.error(
        'Failed to copy wallet address',
        err instanceof Error ? err : new Error(String(err)),
        { address }
      );
      showErrorToast('Failed to copy address', 3000);
    }
  };

  if (!isMounted) {
    return (
      <div className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 sm:px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Skeleton width="7rem" height="1.25rem" />
          <Skeleton width="5rem" height="2rem" />
          <Skeleton width="4rem" height="2rem" />
          <Skeleton width="4rem" height="2rem" />
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 sm:px-6 py-5 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl text-[var(--foreground)]">Wallet</h1>
            <p className="text-sm text-[var(--foreground-secondary)] mt-1 max-w-lg">
              Connect your wallet to view balances, tokens, and vault positions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Assets', value: totalUsdValue, loading: walletLoading, emphasize: true },
    { label: 'Wallet', value: liquidUsdValue, loading: walletLoading, emphasize: false },
    {
      label: 'Vaults',
      value: morphoUsdValue,
      loading: walletLoading || morphoHoldings.isLoading,
      emphasize: false,
    },
  ];

  return (
    <div className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 sm:px-5 py-3 overflow-hidden">
      {/*
        Intrinsic width for layout measurement:
        - `w-max` + nowrap on sm+ so scrollWidth reflects the single-row strip
        - no max-w-full on sm+ (avoids collapsing measure to the half-column)
        - max-w-full only on small screens so the page does not scroll horizontally
      */}
      <div
        ref={measureRef}
        className="flex flex-col max-w-full sm:max-w-none sm:flex-row sm:flex-nowrap sm:items-center gap-3 sm:gap-5 w-max"
      >
        <div className="flex items-baseline gap-2 min-w-0 shrink-0">
          <h1 className="text-lg sm:text-xl text-[var(--foreground)] leading-none">
            Wallet
          </h1>
          {nameLoading && !displayName ? (
            <Skeleton width="6rem" height="1rem" />
          ) : (
            <button
              type="button"
              onClick={copyAddress}
              title={address ? `Click to copy ${address}` : 'Copy address'}
              className="text-sm text-[var(--foreground-secondary)] hover:text-[var(--foreground)] transition-colors cursor-pointer truncate max-w-[10rem] sm:max-w-[14rem]"
            >
              {copied ? 'Copied' : displayName}
            </button>
          )}
        </div>

        <div className="hidden sm:block w-px h-9 bg-[var(--border)] shrink-0" />

        <div className="flex flex-wrap sm:flex-nowrap items-end gap-x-5 sm:gap-x-6 gap-y-2 w-fit shrink-0">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-start w-fit min-w-0">
              <span className="text-xs text-[var(--foreground-secondary)] leading-none mb-1 whitespace-nowrap">
                {stat.label}
              </span>
              {stat.loading ? (
                <Skeleton width={stat.emphasize ? '4.5rem' : '3.5rem'} height="1.5rem" />
              ) : (
                <span
                  className={`font-bold leading-none tabular-nums text-[var(--foreground)] whitespace-nowrap ${
                    stat.emphasize ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
                  }`}
                >
                  {stat.value}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
