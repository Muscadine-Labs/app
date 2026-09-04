'use client';

import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Vault, getVaultLogo } from '@/types/vault';
import type { MorphoVaultData } from '@/types/vault';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useWallet } from '@/contexts/WalletContext';
import { VaultNameWithWrapper } from '@/components/features/vault/VaultNameWithWrapper';
import {
  getVaultRoute,
  hasOnChainVaultShares,
  isCuratedVaultAddress,
  resolvePositionAssetsUsd,
} from '@/lib/vault-utils';
import {
  formatNumber,
  formatPercentage,
  formatPositionTokenAmount,
  formatPositionUsd,
  formatSmartCurrency,
  getDisplayFractionDigits,
} from '@/lib/formatter';
import { formatUnits } from 'viem';
import { Skeleton } from '@/components/ui/Skeleton';
import { useIsClient } from '@/hooks/useClientOnly';
import { useVaultEarnedInterest } from '@/hooks/useVaultEarnedInterest';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
import {
  resolveTotalUnderlyingLiquidityAssets,
  resolveTotalUnderlyingLiquidityUsd,
} from '@/lib/liquidity-utils';

function handleRowKeyDown(event: KeyboardEvent, onActivate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onActivate();
  }
}

function VaultShareLabel({ vault }: { vault: Vault }) {
  return (
    <span className="block text-[10px] text-[var(--foreground-muted)]">
      {vault.vaultSymbol || vault.symbol}
    </span>
  );
}

function formatCompactTokenAmount(rawValue: string | undefined, decimals: number, symbol: string): string {
  const zeroLabel = formatPositionTokenAmount('0', decimals, symbol);
  if (!rawValue) return zeroLabel;

  let value: number;
  try {
    value = Number(formatUnits(BigInt(rawValue), decimals));
  } catch {
    return zeroLabel;
  }

  if (!Number.isFinite(value) || value === 0) return zeroLabel;

  const absValue = Math.abs(value);
  let formatted: string;

  if (absValue >= 1_000_000_000) {
    formatted = `${formatNumber(value / 1_000_000_000, { maximumFractionDigits: 2 })}B`;
  } else if (absValue >= 1_000_000) {
    formatted = `${formatNumber(value / 1_000_000, { maximumFractionDigits: 2 })}M`;
  } else if (absValue >= 1_000) {
    formatted = `${formatNumber(value / 1_000, { maximumFractionDigits: 2 })}K`;
  } else {
    const fractionDigits = getDisplayFractionDigits(symbol);
    formatted = formatNumber(value, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.min(fractionDigits, 20),
    });
  }

  return `${formatted} ${symbol}`;
}

function VaultLogo({ vault, size = 32 }: { vault: Vault; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden bg-white"
      style={{ width: size, height: size }}
    >
      <Image
        src={getVaultLogo(vault.symbol)}
        alt={`${vault.symbol} logo`}
        width={size}
        height={size}
        className={`object-contain ${vault.symbol === 'WETH' ? 'scale-75' : ''}`}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

function MobileStatBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function EarnedInterestCell({
  vault,
  decimals,
  align = 'end',
}: {
  vault: Vault;
  decimals: number;
  align?: 'start' | 'end';
}) {
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();

  const walletPosition = useMemo(
    () =>
      morphoHoldings.positions.find(
        (position) => position.vault.address.toLowerCase() === vault.address.toLowerCase()
      ) ?? null,
    [morphoHoldings.positions, vault.address]
  );

  const resolvedDecimals = resolveAssetDecimals(
    vault.symbol,
    decimals ?? walletPosition?.assetDecimals
  );

  const hasWalletPosition = walletPosition && hasOnChainVaultShares(walletPosition);

  const hookData = useVaultEarnedInterest(
    address && hasWalletPosition && walletPosition?.pnlRaw === undefined
      ? vault.address
      : undefined,
    vault.symbol,
    walletPosition?.assets
  );

  if (!address) {
    return <span className="text-sm text-[var(--foreground-muted)]">-</span>;
  }

  const alignClass = align === 'start' ? 'items-start' : 'items-end';
  const skeletonClass = align === 'start' ? '' : 'ml-auto';

  if (morphoHoldings.isLoading) {
    return <Skeleton width="4rem" height="1rem" className={skeletonClass} />;
  }

  if (!hasWalletPosition) {
    return (
      <div className={`flex flex-col ${alignClass} gap-0.5`}>
        <span className="text-sm font-medium text-[var(--foreground)] tabular-nums">
          {formatPositionTokenAmount('0', resolvedDecimals, vault.symbol)}
        </span>
        <span className="text-xs text-[var(--foreground-secondary)] tabular-nums">
          {formatPositionUsd(0)}
        </span>
      </div>
    );
  }

  const earnedInterestRaw =
    walletPosition.pnlRaw ??
    (hookData.isLoading ? undefined : hookData.earnedInterestRaw || '0');
  const earnedInterestUsd =
    walletPosition.pnlUsd ??
    (hookData.isLoading ? undefined : hookData.earnedInterestUsd);

  if (earnedInterestRaw === undefined || earnedInterestUsd === undefined) {
    return <Skeleton width="4rem" height="1rem" className={skeletonClass} />;
  }

  const earnedRawBigInt = (() => {
    try {
      return BigInt(earnedInterestRaw || '0');
    } catch {
      return BigInt(0);
    }
  })();

  if (earnedRawBigInt <= BigInt(0) && earnedInterestUsd <= 0) {
    return (
      <div className={`flex flex-col ${alignClass} gap-0.5`}>
        <span className="text-sm font-medium text-[var(--foreground)] tabular-nums">
          {formatPositionTokenAmount('0', resolvedDecimals, vault.symbol)}
        </span>
        <span className="text-xs text-[var(--foreground-secondary)] tabular-nums">
          {formatPositionUsd(0)}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${alignClass} gap-0.5`}>
      <span className="text-sm font-medium text-[var(--foreground)] tabular-nums">
        {formatPositionTokenAmount(earnedInterestRaw, resolvedDecimals, vault.symbol)}
      </span>
      <span className="text-xs text-[var(--foreground-secondary)] tabular-nums">
        {formatPositionUsd(earnedInterestUsd)}
      </span>
    </div>
  );
}

function VaultExplorerMobileCard({ vault, showYourPosition }: VaultExplorerRowProps) {
  const router = useRouter();
  const { getVaultData, isLoading } = useVaultData();
  const vaultData = getVaultData(vault.address);
  const loading = isLoading(vault.address);
  const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
  const isCurated = isCuratedVaultAddress(vault.address);
  const openVault = () => {
    if (!isCurated) return;
    router.push(getVaultRoute(vault.address));
  };
  const wrapperProps = isCurated
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: openVault,
        onKeyDown: (event: KeyboardEvent) => handleRowKeyDown(event, openVault),
        className:
          'w-full text-left px-4 py-4 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer',
      }
    : {
        className: 'w-full text-left px-4 py-4 border-b border-[var(--border)]',
      };

  return (
    <div {...wrapperProps}>
      <div className="flex items-start gap-3 mb-3">
        <VaultLogo vault={vault} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <VaultNameWithWrapper name={vault.name} kind={vault.kind} />
            <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground-secondary)]">
              Base
            </span>
            {!isCurated ? (
              <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground-muted)]">
                External
              </span>
            ) : null}
          </div>
          <VaultShareLabel vault={vault} />
        </div>
        <div className="shrink-0 text-right">
          {loading || !vaultData ? (
            <Skeleton width="3rem" height="1rem" />
          ) : (
            <span className="text-sm font-semibold text-[var(--primary)]">
              {formatPercentage(vaultData.apy)}
            </span>
          )}
        </div>
      </div>

      <div className={`grid gap-3 ${showYourPosition ? 'grid-cols-2' : 'grid-cols-2'}`}>
        {showYourPosition && (
          <MobileStatBlock label="Your Position">
            <PositionCell vault={vault} loading={loading} align="start" />
          </MobileStatBlock>
        )}
        <MobileStatBlock label="Deposits">
          <ValueCell
            rawValue={vaultData?.totalAssets}
            usdValue={vaultData?.totalDeposits}
            decimals={decimals}
            symbol={vault.symbol}
            loading={loading}
            align="start"
          />
        </MobileStatBlock>
        <MobileStatBlock label="Liquidity">
          <ValueCell
            rawValue={resolveTotalUnderlyingLiquidityAssets(
              vaultData?.liquidityBreakdown,
              vaultData?.liquidityAssets ?? vaultData?.totalAssets
            )}
            usdValue={resolveTotalUnderlyingLiquidityUsd(
              vaultData?.liquidityBreakdown,
              vaultData?.currentLiquidity
            )}
            decimals={decimals}
            symbol={vault.symbol}
            loading={loading}
            align="start"
          />
        </MobileStatBlock>
      </div>
    </div>
  );
}

function DashboardVaultMobileCard({
  vault,
  positionAssets,
  positionUsd,
  loading,
  vaultData,
}: {
  vault: Vault;
  positionAssets?: string;
  positionUsd: number;
  loading: boolean;
  vaultData: MorphoVaultData | null;
}) {
  const router = useRouter();
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
  const positionRaw = positionAssets
    ? formatPositionTokenAmount(positionAssets, decimals, vault.symbol)
    : '-';
  const isCurated = isCuratedVaultAddress(vault.address);
  const openVault = () => {
    if (!isCurated) return;
    router.push(getVaultRoute(vault.address));
  };
  const wrapperProps = isCurated
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: openVault,
        onKeyDown: (event: KeyboardEvent) => handleRowKeyDown(event, openVault),
        className:
          'w-full text-left px-4 py-4 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer',
      }
    : {
        className:
          'w-full text-left px-4 py-4 border-b border-[var(--border)]',
      };

  return (
    <div {...wrapperProps}>
      <div className="flex items-center gap-3 mb-3">
        <VaultLogo vault={vault} />
        <div className="min-w-0">
          <VaultNameWithWrapper name={vault.name} kind={vault.kind} />
          <VaultShareLabel vault={vault} />
          <span className="text-[10px] text-[var(--foreground-muted)] block">
            {isCurated ? 'Whitelisted' : 'External'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MobileStatBlock label="Your Position">
          {!address || morphoHoldings.isLoading ? (
            <Skeleton width="5rem" height="1rem" />
          ) : hasOnChainVaultShares(
              morphoHoldings.positions.find(
                (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
              )
            ) ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[var(--foreground)]">{positionRaw}</span>
              <span className="text-xs text-[var(--foreground-secondary)]">
                {formatPositionUsd(positionUsd)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-[var(--foreground-muted)]">-</span>
          )}
        </MobileStatBlock>
        <MobileStatBlock label="Earned Interest">
          <EarnedInterestCell vault={vault} decimals={decimals} align="start" />
        </MobileStatBlock>
        <MobileStatBlock label="APY / TVL">
          {loading || !vaultData ? (
            <Skeleton width="4rem" height="1rem" />
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-[var(--primary)]">
                {formatPercentage(vaultData.apy)} APY
              </span>
              <span className="text-xs text-[var(--foreground-secondary)]">
                {formatSmartCurrency(vaultData.totalValueLocked || 0, { alwaysTwoDecimals: true })} TVL
              </span>
            </div>
          )}
        </MobileStatBlock>
      </div>
    </div>
  );
}

function ValueCell({
  rawValue,
  usdValue,
  decimals,
  symbol,
  loading,
  align = 'end',
}: {
  rawValue?: string;
  usdValue?: number;
  decimals: number;
  symbol: string;
  loading: boolean;
  align?: 'start' | 'end';
}) {
  const alignClass = align === 'start' ? 'items-start' : 'items-end';

  if (loading) {
    return (
      <div className={`flex flex-col ${alignClass} gap-1.5`}>
        <Skeleton width="5rem" height="1rem" />
        <Skeleton width="4rem" height="0.875rem" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${alignClass} gap-1`}>
      <span className="text-sm font-medium text-[var(--foreground)]">
        {formatCompactTokenAmount(rawValue, decimals, symbol)}
      </span>
      <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--foreground-secondary)]">
        {formatSmartCurrency(usdValue || 0, { alwaysTwoDecimals: true })}
      </span>
    </div>
  );
}

function PositionCell({
  vault,
  loading,
  align = 'end',
}: {
  vault: Vault;
  loading: boolean;
  align?: 'start' | 'end';
}) {
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const { address } = useAccount();

  const vaultData = getVaultData(vault.address);
  const position = morphoHoldings.positions.find(
    (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
  );
  const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
  const positionUsd = position
    ? resolvePositionAssetsUsd(position, {
        assetDecimals: position.assetDecimals ?? decimals,
        symbol: vault.symbol,
      })
    : 0;
  const positionRaw = position?.assets
    ? formatPositionTokenAmount(
        position.assets,
        position.assetDecimals ?? decimals,
        vault.symbol
      )
    : '-';

  const alignClass = align === 'start' ? 'items-start' : 'items-end';

  if (!address || morphoHoldings.isLoading) {
    return (
      <div className={`flex flex-col ${alignClass} gap-1.5`}>
        <Skeleton width="5rem" height="1rem" />
        <Skeleton width="4rem" height="0.875rem" />
      </div>
    );
  }

  if (!hasOnChainVaultShares(position)) {
    return <span className="text-sm text-[var(--foreground-muted)]">-</span>;
  }

  if (loading && !position?.assets) {
    return (
      <div className={`flex flex-col ${alignClass} gap-1.5`}>
        <Skeleton width="5rem" height="1rem" />
        <Skeleton width="4rem" height="0.875rem" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${alignClass} gap-1`}>
      <span className="text-sm font-medium text-[var(--foreground)]">{positionRaw}</span>
      <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--foreground-secondary)]">
        {formatPositionUsd(positionUsd)}
      </span>
    </div>
  );
}

interface VaultExplorerRowProps {
  vault: Vault;
  showYourPosition: boolean;
}

function VaultExplorerRow({ vault, showYourPosition }: VaultExplorerRowProps) {
  const router = useRouter();
  const { getVaultData, isLoading } = useVaultData();
  const vaultData = getVaultData(vault.address);
  const loading = isLoading(vault.address);
  const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
  const isCurated = isCuratedVaultAddress(vault.address);

  const openVault = () => {
    if (!isCurated) return;
    router.push(getVaultRoute(vault.address));
  };

  return (
    <tr
      role={isCurated ? 'button' : undefined}
      tabIndex={isCurated ? 0 : undefined}
      aria-label={isCurated ? `Open ${vault.name}` : undefined}
      onClick={isCurated ? openVault : undefined}
      onKeyDown={
        isCurated ? (event) => handleRowKeyDown(event, openVault) : undefined
      }
      className={`border-b border-[var(--border)] transition-colors ${
        isCurated
          ? 'hover:bg-[var(--surface-hover)] cursor-pointer'
          : 'cursor-default'
      }`}
    >
      <td className="px-4 sm:px-6 py-4 align-middle">
        <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--foreground-secondary)]">
          Base
        </span>
      </td>

      <td className="px-4 sm:px-6 py-4 align-middle">
        <div className="flex items-center gap-3 min-w-[180px]">
          <VaultLogo vault={vault} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <VaultNameWithWrapper name={vault.name} kind={vault.kind} />
              {!isCurated ? (
                <span className="shrink-0 text-[10px] text-[var(--foreground-muted)]">
                  External
                </span>
              ) : null}
            </div>
            <VaultShareLabel vault={vault} />
          </div>
        </div>
      </td>

      {showYourPosition && (
        <td className="px-4 sm:px-6 py-4 align-middle text-right">
          <PositionCell vault={vault} loading={loading} />
        </td>
      )}

      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        <ValueCell
          rawValue={vaultData?.totalAssets}
          usdValue={vaultData?.totalDeposits}
          decimals={decimals}
          symbol={vault.symbol}
          loading={loading}
        />
      </td>

      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        <ValueCell
          rawValue={resolveTotalUnderlyingLiquidityAssets(
            vaultData?.liquidityBreakdown,
            vaultData?.liquidityAssets ?? vaultData?.totalAssets
          )}
          usdValue={resolveTotalUnderlyingLiquidityUsd(
            vaultData?.liquidityBreakdown,
            vaultData?.currentLiquidity
          )}
          decimals={decimals}
          symbol={vault.symbol}
          loading={loading}
        />
      </td>

      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        {loading || !vaultData ? (
          <Skeleton width="3.5rem" height="1rem" className="ml-auto" />
        ) : (
          <span className="text-sm font-semibold text-[var(--primary)] tabular-nums">
            {formatPercentage(vaultData.apy)}
          </span>
        )}
      </td>
    </tr>
  );
}

interface VaultExplorerTableProps {
  vaults: Vault[];
  emptyMessage?: string;
}

export default function VaultExplorerTable({
  vaults,
  emptyMessage = 'No vaults match the selected filters.',
}: VaultExplorerTableProps) {
  const isMounted = useIsClient();
  const { isConnected } = useAccount();
  const showYourPosition = isConnected;

  if (!isMounted) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <Skeleton width="100%" height="12rem" />
      </div>
    );
  }

  if (vaults.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="lg:hidden">
        {vaults.map((vault) => (
          <VaultExplorerMobileCard
            key={vault.address}
            vault={vault}
            showYourPosition={showYourPosition}
          />
        ))}
      </div>

      <div className="hidden lg:block overflow-x-auto">
      <table className={`w-full ${showYourPosition ? 'min-w-[880px]' : 'min-w-[720px]'}`}>
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)]">Network</th>
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)]">Vault</th>
            {showYourPosition && (
              <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)] text-right">
                Your Position
              </th>
            )}
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)] text-right">Deposits</th>
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)] text-right">Liquidity</th>
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)] text-right">APY</th>
          </tr>
        </thead>
        <tbody>
          {vaults.map((vault) => (
            <VaultExplorerRow
              key={vault.address}
              vault={vault}
              showYourPosition={showYourPosition}
            />
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

// Compact table for dashboard with Your Position column
interface DashboardVaultTableProps {
  vaults: Vault[];
  emptyMessage?: string;
}

function DashboardVaultTableHead() {
  return (
    <thead>
      <tr className="border-b border-[var(--border)] text-left">
        <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)]">Vault</th>
        <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)] text-right">
          Your Position
        </th>
        <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)] text-right">
          Earned Interest
        </th>
        <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)] text-right">
          APY / TVL
        </th>
      </tr>
    </thead>
  );
}

function DashboardVaultEmptyState({
  emptyMessage,
  onExploreVaults,
}: {
  emptyMessage: string;
  onExploreVaults: () => void;
}) {
  return (
    <>
      <div className="hidden @min-[640px]:block min-w-0">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[24%]" />
            <col className="w-[24%]" />
            <col className="w-[24%]" />
          </colgroup>
          <DashboardVaultTableHead />
          <tbody>
            <tr>
              <td colSpan={4} className="px-4 py-10 sm:py-12 text-center">
                <p className="text-sm text-[var(--foreground-muted)] leading-relaxed">
                  {emptyMessage}{' '}
                  <button
                    type="button"
                    onClick={onExploreVaults}
                    className="text-[var(--primary)] hover:underline font-medium"
                  >
                    Explore vaults
                  </button>{' '}
                  to make your first deposit.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="@min-[640px]:hidden px-4 py-10 sm:py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)] leading-relaxed">
          {emptyMessage}{' '}
          <button
            type="button"
            onClick={onExploreVaults}
            className="text-[var(--primary)] hover:underline font-medium"
          >
            Explore vaults
          </button>{' '}
          to make your first deposit.
        </p>
      </div>
    </>
  );
}

export function DashboardVaultTable({
  vaults,
  emptyMessage = 'No vault deposits yet.',
}: DashboardVaultTableProps) {
  const router = useRouter();
  const isMounted = useIsClient();
  const { morphoHoldings } = useWallet();
  const { getVaultData, isLoading } = useVaultData();
  const { address } = useAccount();

  if (!isMounted) {
    return (
      <div className="px-4 py-8">
        <Skeleton width="100%" height="8rem" />
      </div>
    );
  }

  if (vaults.length === 0) {
    if (morphoHoldings.isLoading) {
      return (
        <div className="@container min-w-0">
          <div className="hidden @min-[640px]:block min-w-0">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
              </colgroup>
              <DashboardVaultTableHead />
              <tbody>
                <tr>
                  <td colSpan={4} className="px-4 py-8">
                    <Skeleton width="100%" height="4rem" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="@min-[640px]:hidden px-4 py-8">
            <Skeleton width="100%" height="6rem" />
          </div>
        </div>
      );
    }

    return (
      <div className="@container min-w-0">
        <DashboardVaultEmptyState
          emptyMessage={emptyMessage}
          onExploreVaults={() => router.push('/vaults')}
        />
      </div>
    );
  }

  return (
    // Container width (not viewport): half-column dashboards stay on cards until wide enough for the table.
    <div className="@container min-w-0">
      <div className="@min-[640px]:hidden">
        {vaults.map((vault) => {
          const vaultData = getVaultData(vault.address) as MorphoVaultData | null;
          const loading = isLoading(vault.address);
          const position = morphoHoldings.positions.find(
            (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
          );
          const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
          const positionUsd = position
            ? resolvePositionAssetsUsd(position, { assetDecimals: decimals, symbol: vault.symbol })
            : 0;

          return (
            <DashboardVaultMobileCard
              key={vault.address}
              vault={vault}
              positionAssets={position?.assets}
              positionUsd={positionUsd}
              loading={loading}
              vaultData={vaultData}
            />
          );
        })}
      </div>

      <div className="hidden @min-[640px]:block min-w-0">
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[24%]" />
          <col className="w-[24%]" />
          <col className="w-[24%]" />
        </colgroup>
        <DashboardVaultTableHead />
        <tbody>
          {vaults.map((vault) => {
            const vaultData = getVaultData(vault.address) as MorphoVaultData | null;
            const loading = isLoading(vault.address);
            const position = morphoHoldings.positions.find(
              (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
            );
            const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
            const positionUsd = position
              ? resolvePositionAssetsUsd(position, { assetDecimals: decimals, symbol: vault.symbol })
              : 0;
            const positionRaw = position?.assets
              ? formatPositionTokenAmount(position.assets, decimals, vault.symbol)
              : '-';

            const openVault = () => {
              if (!isCuratedVaultAddress(vault.address)) return;
              router.push(getVaultRoute(vault.address));
            };
            const isCurated = isCuratedVaultAddress(vault.address);

            return (
              <tr
                key={vault.address}
                role={isCurated ? 'button' : undefined}
                tabIndex={isCurated ? 0 : undefined}
                aria-label={isCurated ? `Open ${vault.name}` : undefined}
                onClick={isCurated ? openVault : undefined}
                onKeyDown={
                  isCurated
                    ? (event) => handleRowKeyDown(event, openVault)
                    : undefined
                }
                className={`border-b border-[var(--border)] transition-colors ${
                  isCurated
                    ? 'hover:bg-[var(--surface-hover)] cursor-pointer'
                    : 'cursor-default'
                }`}
              >
                <td className="px-2 py-3 align-middle">
                  <div className="flex items-center gap-2 min-w-0">
                    <VaultLogo vault={vault} size={28} />
                    <div className="min-w-0">
                      <VaultNameWithWrapper name={vault.name} kind={vault.kind} />
                      <VaultShareLabel vault={vault} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3 align-middle text-right">
                  {!address || morphoHoldings.isLoading ? (
                    <Skeleton width="4.5rem" height="1rem" className="ml-auto" />
                  ) : hasOnChainVaultShares(position) ? (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-sm font-medium text-[var(--foreground)] tabular-nums">{positionRaw}</span>
                      <span className="text-xs text-[var(--foreground-secondary)] tabular-nums">
                        {formatPositionUsd(positionUsd)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--foreground-muted)]">-</span>
                  )}
                </td>
                <td className="px-2 py-3 align-middle text-right">
                  <EarnedInterestCell vault={vault} decimals={decimals} />
                </td>
                <td className="px-2 py-3 align-middle text-right">
                  {loading || !vaultData ? (
                    <Skeleton width="4rem" height="1rem" className="ml-auto" />
                  ) : (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-sm font-semibold text-[var(--primary)] tabular-nums">
                        {formatPercentage(vaultData.apy)} APY
                      </span>
                      <span className="text-xs text-[var(--foreground-secondary)] tabular-nums">
                        {formatSmartCurrency(vaultData.totalValueLocked || 0, { alwaysTwoDecimals: true })} TVL
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
