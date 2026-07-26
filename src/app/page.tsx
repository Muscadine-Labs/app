'use client';

import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import {
  WalletOverview,
  PortfolioPositionChart,
  DashboardTokensPanel,
  DashboardStocksPanel,
} from '@/components/features/wallet';
import { DashboardVaultTable } from '@/components/features/vault/VaultExplorerTable';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { useWalletStripNeedsFullWidth } from '@/hooks/useWalletStripNeedsFullWidth';
import { useWalletDisplayName } from '@/hooks/useWalletDisplayName';
import { useWallet } from '@/contexts/WalletContext';
import {
  findVaultByAddress,
  sortVaultsForDisplay,
  hasOnChainVaultShares,
  resolvePositionAssetsUsd,
} from '@/lib/vault-utils';
import {
  buildDashboardAssetHoldings,
  buildExtraWalletTokenHoldings,
  buildStockHoldings,
} from '@/lib/assets';
import { Vault } from '@/types/vault';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { VaultStrategy } from '@/lib/vaults';

/** Chart height under the wallet. */
const CHART_HEIGHT_CLASS = 'h-[300px] sm:h-[340px] min-[1000px]:h-[380px]';

/** Visible rows before the list scrolls (exact count). */
const PANEL_VISIBLE_ROWS = 4;

const LIST_SCROLL_MAX = 'max-h-[16rem]';
const VAULTS_SCROLL_MAX = 'max-h-[20rem]';

function DashboardPanel({
  title,
  subtitle,
  children,
  className = '',
  scrollable,
  bodyMaxClass,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  scrollable: boolean;
  bodyMaxClass: string;
}) {
  return (
    <div
      className={`rounded-lg overflow-hidden min-w-0 flex flex-col bg-[var(--surface)] w-full h-fit min-h-0 ${className}`}
    >
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[var(--border)] shrink-0">
        <h2 className="text-sm sm:text-base text-[var(--foreground)]">{title}</h2>
        {subtitle ? (
          <p className="text-[10px] sm:text-xs text-[var(--foreground-muted)] mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      <div
        className={`min-h-0 ${scrollable ? `overflow-y-auto ${bodyMaxClass}` : 'overflow-visible'}`}
      >
        {children}
      </div>
    </div>
  );
}

function DashboardSideColumn({
  className = '',
  hasVaults,
  depositedVaults,
  hasTokens,
  hasStocks,
  tokenCount,
  stockCount,
}: {
  className?: string;
  hasVaults: boolean;
  depositedVaults: Vault[];
  hasTokens: boolean;
  hasStocks: boolean;
  tokenCount: number;
  stockCount: number;
}) {
  return (
    <div className={`flex flex-col gap-3 sm:gap-4 min-w-0 w-full ${className}`}>
      {hasVaults ? (
        <DashboardPanel
          title="Your Vaults"
          scrollable={depositedVaults.length > PANEL_VISIBLE_ROWS}
          bodyMaxClass={VAULTS_SCROLL_MAX}
        >
          <DashboardVaultTable vaults={depositedVaults} />
        </DashboardPanel>
      ) : null}
      {hasTokens ? (
        <DashboardPanel
          title="Tokens"
          subtitle="Wallet + vaults combined"
          scrollable={tokenCount > PANEL_VISIBLE_ROWS}
          bodyMaxClass={LIST_SCROLL_MAX}
        >
          <DashboardTokensPanel />
        </DashboardPanel>
      ) : null}
      {hasStocks ? (
        <DashboardPanel
          title="Stocks"
          subtitle="Base network"
          scrollable={stockCount > PANEL_VISIBLE_ROWS}
          bodyMaxClass={LIST_SCROLL_MAX}
        >
          <DashboardStocksPanel />
        </DashboardPanel>
      ) : null}
    </div>
  );
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const {
    morphoHoldings,
    tokenBalances,
    loading,
    totalUsdValue,
    liquidUsdValue,
    morphoUsdValue,
  } = useWallet();
  const { displayName, isLoading: nameLoading } = useWalletDisplayName(
    isConnected ? address : undefined
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const walletStripRef = useRef<HTMLDivElement>(null);

  const depositedVaults: Vault[] = useMemo(() => {
    const vaults: Vault[] = morphoHoldings.positions
      .filter(
        (position) =>
          position.version === 'v2' && hasOnChainVaultShares(position)
      )
      .map((position) => {
        const curated = findVaultByAddress(position.vault.address);
        if (curated) {
          return { ...curated, version: position.version ?? curated.version };
        }

        return {
          address: position.vault.address,
          name: position.vault.name,
          symbol: position.vault.symbol,
          vaultSymbol: position.vault.vaultSymbol,
          chainId: BASE_CHAIN_ID,
          version: position.version ?? 'v2',
          strategy: position.vault.strategy as VaultStrategy | undefined,
          isCurated: false,
        };
      });

    return sortVaultsForDisplay(
      vaults,
      morphoHoldings.positions,
      (addr) => {
        const position = morphoHoldings.positions.find(
          (p) => p.vault.address.toLowerCase() === addr.toLowerCase()
        );
        return position ? resolvePositionAssetsUsd(position) : 0;
      }
    );
  }, [morphoHoldings.positions]);

  const hasVaults = isConnected && depositedVaults.length > 0;

  const tokenCount = useMemo(() => {
    if (!isConnected || loading) return 0;
    const curated = buildDashboardAssetHoldings(
      tokenBalances,
      morphoHoldings.isLoading ? [] : morphoHoldings.positions
    );
    const extras = buildExtraWalletTokenHoldings(tokenBalances);
    return curated.length + extras.length;
  }, [
    isConnected,
    loading,
    morphoHoldings.isLoading,
    morphoHoldings.positions,
    tokenBalances,
  ]);

  const stockCount = useMemo(() => {
    if (!isConnected || loading) return 0;
    return buildStockHoldings(tokenBalances).length;
  }, [isConnected, loading, tokenBalances]);

  const hasTokens = tokenCount > 0;
  const hasStocks = stockCount > 0;

  useVaultListPreloader(depositedVaults);

  // Right column stacks vaults / tokens / stocks whenever any exist — avoids
  // jumping Tokens out to a full-width pair row when Stocks appear.
  const showRightColumn = hasVaults || hasTokens || hasStocks;

  const layoutKey = [
    totalUsdValue,
    liquidUsdValue,
    morphoUsdValue,
    loading ? 'loading' : 'ready',
    morphoHoldings.isLoading ? 'morpho-loading' : 'morpho-ready',
    showRightColumn ? 'right' : 'solo',
    address ?? 'none',
    nameLoading ? 'name-loading' : displayName,
  ].join('|');

  const wideWallet = useWalletStripNeedsFullWidth({
    viewportRef,
    stripRef: walletStripRef,
    enabled: isConnected && showRightColumn,
    layoutKey,
  });

  /**
   * Desktop (≥1000px):
   * - compact: two independent columns (wallet+chart | side) — avoids row-stretch gap
   *   when the right column is taller than the wallet strip.
   * - wide: wallet full-width, then chart | side (wallet strip too wide for half column).
   * Mobile: single column stack (wallet → chart → side).
   */
  const useWideDesktopLayout = showRightColumn && wideWallet;

  const sideProps = {
    hasVaults,
    depositedVaults,
    hasTokens,
    hasStocks,
    tokenCount,
    stockCount,
  };

  return (
    <div className="w-full bg-[var(--background)] h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 sm:gap-4 p-4 sm:p-6 min-h-full">
          {useWideDesktopLayout ? (
            <div
              ref={viewportRef}
              className="grid grid-cols-1 gap-3 sm:gap-4 min-w-0 items-start min-[1000px]:grid-cols-2 min-[1000px]:[grid-template-areas:var(--dash-areas)]"
              style={{ ['--dash-areas' as string]: '"wallet wallet" "chart side"' } as CSSProperties}
            >
              <div className="min-w-0 min-[1000px]:[grid-area:wallet]">
                <WalletOverview measureRef={walletStripRef} />
              </div>
              <div
                className={`rounded-lg ${CHART_HEIGHT_CLASS} flex flex-col min-w-0 w-full min-[1000px]:[grid-area:chart]`}
              >
                <PortfolioPositionChart key={address ?? 'disconnected'} />
              </div>
              <DashboardSideColumn
                className="min-[1000px]:[grid-area:side]"
                {...sideProps}
              />
            </div>
          ) : showRightColumn ? (
            <div
              ref={viewportRef}
              className="grid grid-cols-1 gap-3 sm:gap-4 min-w-0 items-start min-[1000px]:grid-cols-2"
            >
              {/* Left column stacks tightly — do not share rows with the side column. */}
              <div className="flex flex-col gap-3 sm:gap-4 min-w-0">
                <WalletOverview measureRef={walletStripRef} />
                <div
                  className={`rounded-lg ${CHART_HEIGHT_CLASS} flex flex-col min-w-0 w-full`}
                >
                  <PortfolioPositionChart key={address ?? 'disconnected'} />
                </div>
              </div>
              <DashboardSideColumn {...sideProps} />
            </div>
          ) : (
            <div ref={viewportRef} className="flex flex-col gap-3 sm:gap-4 min-w-0">
              <WalletOverview measureRef={walletStripRef} />
              <div
                className={`rounded-lg ${CHART_HEIGHT_CLASS} flex flex-col min-w-0 w-full`}
              >
                <PortfolioPositionChart key={address ?? 'disconnected'} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
