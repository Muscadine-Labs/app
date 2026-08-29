'use client';

import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import {
  WalletOverview,
  PortfolioPositionChart,
} from '@/components/features/wallet';
import { DashboardVaultTable } from '@/components/features/vault/VaultExplorerTable';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import {
  useIsDashboardSplitLayout,
  useWalletStripNeedsFullWidth,
} from '@/hooks/useWalletStripNeedsFullWidth';
import { useWalletDisplayName } from '@/hooks/useWalletDisplayName';
import { useWallet } from '@/contexts/WalletContext';
import {
  findVaultByAddress,
  sortVaultsForDisplay,
  hasOnChainVaultShares,
  resolvePositionAssetsUsd,
} from '@/lib/vault-utils';
import { Vault } from '@/types/vault';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { VaultStrategy } from '@/lib/vaults';

/** Chart height under the wallet. */
const CHART_HEIGHT_CLASS = 'h-[300px] sm:h-[340px] min-[1000px]:h-[380px]';
const PANEL_SCROLL_MAX = 'max-h-[20rem]';
/** Visible rows before Your Vaults scrolls. */
const DASHBOARD_PANEL_VISIBLE_ROWS = 4;

function DashboardPanel({
  title,
  children,
  className = '',
  scrollable,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  scrollable: boolean;
}) {
  return (
    <div
      className={`rounded-lg overflow-hidden min-w-0 flex flex-col bg-[var(--surface)] w-full h-fit min-h-0 ${className}`}
    >
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[var(--border)] shrink-0">
        <h2 className="text-sm sm:text-base text-[var(--foreground)]">{title}</h2>
      </div>
      <div
        className={`min-h-0 ${scrollable ? `overflow-y-auto ${PANEL_SCROLL_MAX}` : 'overflow-visible'}`}
      >
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const {
    morphoHoldings,
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

  useVaultListPreloader(depositedVaults);

  const isSplitLayout = useIsDashboardSplitLayout();
  const showSideColumn = hasVaults;

  const layoutKey = [
    totalUsdValue,
    liquidUsdValue,
    morphoUsdValue,
    loading ? 'loading' : 'ready',
    morphoHoldings.isLoading ? 'morpho-loading' : 'morpho-ready',
    showSideColumn ? 'right' : 'solo',
    address ?? 'none',
    nameLoading ? 'name-loading' : displayName,
  ].join('|');

  const wideWallet = useWalletStripNeedsFullWidth({
    viewportRef,
    stripRef: walletStripRef,
    enabled: isConnected && showSideColumn,
    layoutKey,
  });

  /**
   * Desktop (≥1000px): two independent columns. Vaults sit beside the chart.
   * Wide wallet: wallet full-width, then chart | vaults. Below 1000px:
   * wallet → chart → Vaults.
   */
  const useWideDesktopLayout = showSideColumn && wideWallet && isSplitLayout;

  const vaultsPanel = hasVaults ? (
    <DashboardPanel
      title="Your Vaults"
      scrollable={depositedVaults.length > DASHBOARD_PANEL_VISIBLE_ROWS}
    >
      <DashboardVaultTable vaults={depositedVaults} />
    </DashboardPanel>
  ) : null;

  const chartBlock = (
    <div className={`rounded-lg ${CHART_HEIGHT_CLASS} flex flex-col min-w-0 w-full`}>
      <PortfolioPositionChart key={address ?? 'disconnected'} />
    </div>
  );

  return (
    <div className="w-full bg-[var(--background)] h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 sm:gap-4 p-4 sm:p-6 min-h-full">
          {useWideDesktopLayout ? (
            <div
              ref={viewportRef}
              className="grid grid-cols-1 gap-3 sm:gap-4 min-w-0 items-start min-[1000px]:grid-cols-2 min-[1000px]:[grid-template-areas:var(--dash-areas)]"
              style={
                {
                  ['--dash-areas' as string]: '"wallet wallet" "chart side"',
                } as CSSProperties
              }
            >
              <div className="min-w-0 min-[1000px]:[grid-area:wallet]">
                <WalletOverview measureRef={walletStripRef} />
              </div>
              <div className="flex flex-col gap-3 sm:gap-4 min-w-0 w-full min-[1000px]:[grid-area:chart]">
                {chartBlock}
              </div>
              <div className="min-w-0 w-full min-[1000px]:[grid-area:side]">
                {vaultsPanel}
              </div>
            </div>
          ) : isSplitLayout && showSideColumn ? (
            <div
              ref={viewportRef}
              className="grid grid-cols-1 gap-3 sm:gap-4 min-w-0 items-start min-[1000px]:grid-cols-2"
            >
              <div className="flex flex-col gap-3 sm:gap-4 min-w-0">
                <WalletOverview measureRef={walletStripRef} />
                {chartBlock}
              </div>
              {vaultsPanel}
            </div>
          ) : (
            <div ref={viewportRef} className="flex flex-col gap-3 sm:gap-4 min-w-0">
              <WalletOverview measureRef={walletStripRef} />
              {chartBlock}
              {vaultsPanel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
