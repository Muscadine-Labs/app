'use client';

import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Vault, getVaultLogo } from '@/types/vault';
import type { MorphoVaultData } from '@/types/vault';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultPrefs } from '@/contexts/VaultPrefsContext';
import { getPairedVaultAddress } from '@/lib/vaults';
import { VaultName } from '@/components/features/vault/VaultName';
import {
  getVaultRoute,
  closedPairEarnedPnl,
  groupVaultFamilies,
  type VaultFamily,
  selectVaultKindMarkAddresses,
  hasOnChainVaultShares,
  isCuratedVaultAddress,
  resolvePositionAssetsUsd,
} from '@/lib/vault-utils';
import {
  formatDashboardTokenAmount,
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
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
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

/** Dashboard value cell: one-line amount over one-line USD, same size in every column. */
function DashboardStackedValue({
  primary,
  secondary,
  title,
  align = 'end',
  primaryClassName = 'font-medium text-[var(--foreground)]',
}: {
  primary: ReactNode;
  secondary: ReactNode;
  title?: string;
  align?: 'start' | 'end';
  primaryClassName?: string;
}) {
  return (
    <div
      title={title}
      className={`flex min-w-0 flex-col gap-0.5 ${
        align === 'end' ? 'items-end text-right' : 'items-start text-left'
      }`}
    >
      <span className={`max-w-full truncate whitespace-nowrap text-sm tabular-nums ${primaryClassName}`}>
        {primary}
      </span>
      <span className="max-w-full truncate whitespace-nowrap text-xs tabular-nums text-[var(--foreground-secondary)]">
        {secondary}
      </span>
    </div>
  );
}

function DashboardTokenValue({
  rawValue,
  decimals,
  symbol,
  usd,
  align,
}: {
  rawValue: string | undefined;
  decimals: number;
  symbol: string;
  usd: number;
  align?: 'start' | 'end';
}) {
  return (
    <DashboardStackedValue
      align={align}
      title={formatPositionTokenAmount(rawValue ?? '0', decimals, symbol)}
      primary={formatDashboardTokenAmount(rawValue, decimals, symbol)}
      secondary={formatPositionUsd(usd)}
    />
  );
}

function DashboardApyTvlValue({
  vaultData,
  align,
}: {
  vaultData: MorphoVaultData;
  align?: 'start' | 'end';
}) {
  return (
    <DashboardStackedValue
      align={align}
      primaryClassName="font-semibold text-[var(--primary)]"
      primary={`${formatPercentage(vaultData.apy)} APY`}
      secondary={`${formatSmartCurrency(vaultData.totalValueLocked || 0, { alwaysTwoDecimals: true })} TVL`}
    />
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

function flooredPnlRaw(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = BigInt(raw);
    return value > BigInt(0) ? value.toString() : '0';
  } catch {
    return '0';
  }
}

function EarnedInterestCell({
  vault,
  decimals,
  align = 'end',
  combinePair = false,
}: {
  vault: Vault;
  decimals: number;
  align?: 'start' | 'end';
  /** Family row that stands for both contracts of a held pair: add the pair's profit. */
  combinePair?: boolean;
}) {
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const { sharedData } = useVaultPrefs();
  const pairPosition = useMemo(() => {
    if (!combinePair) return null;
    const pairAddress = getPairedVaultAddress(vault.address)?.toLowerCase();
    if (!pairAddress) return null;
    const position = morphoHoldings.positions.find(
      (item) => item.vault.address.toLowerCase() === pairAddress
    );
    return position && hasOnChainVaultShares(position) ? position : null;
  }, [combinePair, morphoHoldings.positions, vault.address]);

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
  const pairHookData = useVaultEarnedInterest(
    address && pairPosition && pairPosition.pnlRaw === undefined
      ? pairPosition.vault.address
      : undefined,
    vault.symbol,
    pairPosition?.assets
  );

  if (!address) {
    return <span className="text-sm text-[var(--foreground-muted)]">-</span>;
  }

  const skeletonClass = align === 'start' ? '' : 'ml-auto';
  const zeroValue = (
    <DashboardTokenValue
      rawValue="0"
      decimals={resolvedDecimals}
      symbol={vault.symbol}
      usd={0}
      align={align}
    />
  );

  if (morphoHoldings.isLoading) {
    return <Skeleton width="4rem" height="1rem" className={skeletonClass} />;
  }

  if (!hasWalletPosition) return zeroValue;

  const ownRaw =
    walletPosition.pnlRaw ??
    (hookData.isLoading ? undefined : hookData.earnedInterestRaw || '0');
  const ownUsd =
    walletPosition.pnlUsd ??
    (hookData.isLoading ? undefined : hookData.earnedInterestUsd);
  const flooredOwnRaw = flooredPnlRaw(ownRaw);
  const flooredOwnUsd = ownUsd === undefined ? undefined : Math.max(0, ownUsd);
  // A closed pair's profit rides on this row; a family row also adds its held pair's profit.
  const heldPair = pairPosition
    ? {
        pnlRaw: flooredPnlRaw(
          pairPosition.pnlRaw ??
            (pairHookData.isLoading ? undefined : pairHookData.earnedInterestRaw || '0')
        ),
        pnlUsd:
          pairPosition.pnlUsd ??
          (pairHookData.isLoading ? undefined : pairHookData.earnedInterestUsd),
      }
    : null;
  if (heldPair && (heldPair.pnlRaw === undefined || heldPair.pnlUsd === undefined)) {
    return <Skeleton width="4rem" height="1rem" className={skeletonClass} />;
  }
  // Shared vault data off: a closed pair's profit stays with that contract.
  const closedPair =
    (sharedData ? closedPairEarnedPnl(morphoHoldings.positions, vault.address) : null) ??
    (heldPair ? { pnlRaw: heldPair.pnlRaw!, pnlUsd: Math.max(0, heldPair.pnlUsd!) } : null);
  const earnedInterestRaw = (() => {
    if (flooredOwnRaw === undefined) return undefined;
    if (!closedPair) return flooredOwnRaw;
    try {
      return (BigInt(flooredOwnRaw) + BigInt(closedPair.pnlRaw)).toString();
    } catch {
      return flooredOwnRaw;
    }
  })();
  const earnedInterestUsd =
    flooredOwnUsd === undefined
      ? undefined
      : flooredOwnUsd + (closedPair?.pnlUsd ?? 0);

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

  if (earnedRawBigInt <= BigInt(0) && earnedInterestUsd <= 0) return zeroValue;

  return (
    <DashboardTokenValue
      rawValue={earnedInterestRaw}
      decimals={resolvedDecimals}
      symbol={vault.symbol}
      usd={earnedInterestUsd}
      align={align}
    />
  );
}

function VaultExplorerMobileCard({
  vault,
  showYourPosition,
  showKind,
  restricted,
  nested = false,
}: VaultExplorerRowProps) {
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
  const rowProps = isCurated
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: openVault,
        onKeyDown: (event: KeyboardEvent) => handleRowKeyDown(event, openVault),
        className: `w-full text-left ${nested ? NESTED_CARD_CLASS : 'px-4'} py-4 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer`,
      }
    : {
        className: `w-full text-left ${nested ? NESTED_CARD_CLASS : 'px-4'} py-4 border-b border-[var(--border)]`,
      };

  return (
    <div {...rowProps}>
      <div className="flex items-start gap-3 mb-3">
        <VaultLogo vault={vault} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <VaultName name={vault.name} kind={vault.kind} showKind={showKind} />
            {restricted ? <RestrictedMark /> : null}
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
  showKind,
  nested = false,
  showCuratedLabel = false,
}: {
  vault: Vault;
  showKind?: boolean;
  nested?: boolean;
  /** Label Muscadine vaults "Whitelisted" only when the list also has an external vault. */
  showCuratedLabel?: boolean;
  positionAssets?: string;
  positionUsd: number;
  loading: boolean;
  vaultData: MorphoVaultData | null;
}) {
  const router = useRouter();
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
  const isCurated = isCuratedVaultAddress(vault.address);
  const openVault = () => {
    if (!isCurated) return;
    router.push(getVaultRoute(vault.address));
  };
  const rowProps = isCurated
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: openVault,
        onKeyDown: (event: KeyboardEvent) => handleRowKeyDown(event, openVault),
        className: `w-full text-left ${nested ? 'pl-9 pr-3' : 'px-3'} py-3 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer`,
      }
    : {
        className: `w-full text-left ${nested ? 'pl-9 pr-3' : 'px-3'} py-3 border-b border-[var(--border)]`,
      };

  return (
    <div {...rowProps}>
      <div className="flex items-start gap-2.5 mb-2">
        <VaultLogo vault={vault} />
        <div className="min-w-0 flex-1">
          <VaultName name={vault.name} lines={2} kind={vault.kind} showKind={showKind} />
          <VaultShareLabel vault={vault} />
          {!isCurated || showCuratedLabel ? (
            <span className="text-[10px] text-[var(--foreground-muted)] block">
              {isCurated ? 'Whitelisted' : 'External'}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MobileStatBlock label="Your Position">
          {!address || morphoHoldings.isLoading ? (
            <Skeleton width="5rem" height="1rem" />
          ) : hasOnChainVaultShares(
              morphoHoldings.positions.find(
                (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
              )
            ) ? (
            <DashboardTokenValue
              rawValue={positionAssets}
              decimals={decimals}
              symbol={vault.symbol}
              usd={positionUsd}
              align="start"
            />
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
            <DashboardApyTvlValue vaultData={vaultData} align="start" />
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
  /** Label Wrapper / Underlying (both contracts of the pair are listed). */
  showKind?: boolean;
  /** Listed, but this wallet cannot deposit (send-assets gate says no). */
  restricted?: boolean;
  /** Child row under a family row. */
  nested?: boolean;
}

function RestrictedMark() {
  return (
    <span
      className="shrink-0 inline-flex rounded-md bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--warning)] whitespace-nowrap"
      title="Deposits are limited to approved wallets. Withdrawals stay open."
    >
      Approved wallets only
    </span>
  );
}

function VaultExplorerRow({
  vault,
  showYourPosition,
  showKind,
  restricted,
  nested = false,
}: VaultExplorerRowProps) {
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
        <div
          className={`flex items-center gap-3 min-w-[180px] ${nested ? NESTED_CELL_CLASS : ''}`}
        >
          <VaultLogo vault={vault} size={nested ? 24 : 32} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <VaultName name={vault.name} kind={vault.kind} showKind={showKind} />
              {restricted ? <RestrictedMark /> : null}
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

/** Child rows sit under their family row, indented with a tree line. */
const NESTED_CELL_CLASS = 'ml-5 pl-4 border-l border-[var(--border)]';
const NESTED_CARD_CLASS = 'pl-10 pr-4';

function FamilyChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-[var(--foreground-secondary)] transition-transform ${
        expanded ? 'rotate-90' : ''
      }`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function formatApyRange(apys: number[]): string {
  if (apys.length === 0) return '';
  const labels = [...new Set(apys.map((apy) => formatPercentage(apy)))];
  if (labels.length === 1) return labels[0];
  const min = Math.min(...apys);
  const max = Math.max(...apys);
  return `${formatPercentage(min)} – ${formatPercentage(max)}`;
}

/**
 * Totals for a wrapper / underlying family. Deposits, TVL and liquidity come from the
 * underlying, which already holds the wrapper's funds; position and profit add both sides.
 */
function useFamilySummary(family: VaultFamily) {
  const { morphoHoldings } = useWallet();
  const { getVaultData, isLoading } = useVaultData();
  const lead = family.members.find((member) => member.kind !== 'wrapper') ?? family.members[0];
  const leadData = getVaultData(lead.address) as MorphoVaultData | null;
  const memberData = family.members.map((member) => getVaultData(member.address));
  const loading = family.members.some((member) => isLoading(member.address));
  const decimals = resolveAssetDecimals(lead.symbol, leadData?.assetDecimals);

  const heldPositions = family.members
    .map((member) =>
      morphoHoldings.positions.find(
        (item) => item.vault.address.toLowerCase() === member.address.toLowerCase()
      )
    )
    .filter((position) => hasOnChainVaultShares(position));

  let positionRaw = BigInt(0);
  let positionUsd = 0;
  for (const position of heldPositions) {
    if (!position) continue;
    try {
      positionRaw += BigInt(position.assets ?? '0');
    } catch {
      // Skip a malformed amount; the USD sum still counts it.
    }
    positionUsd += resolvePositionAssetsUsd(position, {
      assetDecimals: position.assetDecimals ?? decimals,
      symbol: lead.symbol,
    });
  }

  const apys = memberData
    .filter((data): data is NonNullable<typeof data> => data !== null)
    .map((data) => data.apy ?? 0);

  return {
    lead,
    leadData,
    loading,
    decimals,
    held: heldPositions.length > 0,
    positionRaw: positionRaw.toString(),
    positionUsd,
    apyLabel: memberData.every((data) => data !== null) ? formatApyRange(apys) : null,
    holdingsLoading: morphoHoldings.isLoading,
  };
}

function FamilyKinds({ family }: { family: VaultFamily }) {
  return (
    <span className="block text-[10px] text-[var(--foreground-muted)]">
      {family.members
        .map((member) => (member.kind === 'wrapper' ? 'Wrapper' : 'Underlying'))
        .join(' + ')}
    </span>
  );
}

interface VaultFamilyRowProps {
  family: VaultFamily;
  expanded: boolean;
  onToggle: () => void;
  showYourPosition: boolean;
}

function familyToggleProps(name: string, expanded: boolean, onToggle: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': expanded,
    'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${name}`,
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      onToggle();
    },
    onKeyDown: (event: KeyboardEvent) => handleRowKeyDown(event, onToggle),
  };
}

function VaultFamilyRow({ family, expanded, onToggle, showYourPosition }: VaultFamilyRowProps) {
  const summary = useFamilySummary(family);
  const { lead, leadData, loading, decimals } = summary;

  return (
    <tr
      {...familyToggleProps(lead.name, expanded, onToggle)}
      className="border-b border-[var(--border)] transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
    >
      <td className="px-4 sm:px-6 py-4 align-middle">
        <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--foreground-secondary)]">
          Base
        </span>
      </td>
      <td className="px-4 sm:px-6 py-4 align-middle">
        <div className="flex items-center gap-2 min-w-[180px]">
          <FamilyChevron expanded={expanded} />
          <VaultLogo vault={lead} />
          <div className="min-w-0">
            <VaultName name={lead.name} />
            <FamilyKinds family={family} />
          </div>
        </div>
      </td>
      {showYourPosition && (
        <td className="px-4 sm:px-6 py-4 align-middle text-right">
          <FamilyPositionValue summary={summary} />
        </td>
      )}
      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        <ValueCell
          rawValue={leadData?.totalAssets}
          usdValue={leadData?.totalDeposits}
          decimals={decimals}
          symbol={lead.symbol}
          loading={loading}
        />
      </td>
      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        <ValueCell
          rawValue={resolveTotalUnderlyingLiquidityAssets(
            leadData?.liquidityBreakdown,
            leadData?.liquidityAssets ?? leadData?.totalAssets
          )}
          usdValue={resolveTotalUnderlyingLiquidityUsd(
            leadData?.liquidityBreakdown,
            leadData?.currentLiquidity
          )}
          decimals={decimals}
          symbol={lead.symbol}
          loading={loading}
        />
      </td>
      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        {summary.apyLabel === null ? (
          <Skeleton width="3.5rem" height="1rem" className="ml-auto" />
        ) : (
          <span className="text-sm font-semibold text-[var(--primary)] tabular-nums whitespace-nowrap">
            {summary.apyLabel}
          </span>
        )}
      </td>
    </tr>
  );
}

function FamilyPositionValue({
  summary,
  align = 'end',
}: {
  summary: ReturnType<typeof useFamilySummary>;
  align?: 'start' | 'end';
}) {
  const { address } = useAccount();
  const alignClass = align === 'start' ? 'items-start' : 'items-end';
  if (!address || summary.holdingsLoading) {
    return (
      <div className={`flex flex-col ${alignClass} gap-1.5`}>
        <Skeleton width="5rem" height="1rem" />
        <Skeleton width="4rem" height="0.875rem" />
      </div>
    );
  }
  if (!summary.held) {
    return <span className="text-sm text-[var(--foreground-muted)]">-</span>;
  }
  return (
    <div className={`flex flex-col ${alignClass} gap-1`}>
      <span className="text-sm font-medium text-[var(--foreground)]">
        {formatPositionTokenAmount(summary.positionRaw, summary.decimals, summary.lead.symbol)}
      </span>
      <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--foreground-secondary)]">
        {formatPositionUsd(summary.positionUsd)}
      </span>
    </div>
  );
}

function VaultFamilyMobileCard({ family, expanded, onToggle, showYourPosition }: VaultFamilyRowProps) {
  const summary = useFamilySummary(family);
  const { lead, leadData, loading, decimals } = summary;

  return (
    <div
      {...familyToggleProps(lead.name, expanded, onToggle)}
      className="w-full text-left px-4 py-4 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <FamilyChevron expanded={expanded} />
          <VaultLogo vault={lead} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <VaultName name={lead.name} />
            <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground-secondary)]">
              Base
            </span>
          </div>
          <FamilyKinds family={family} />
        </div>
        <div className="shrink-0 text-right">
          {summary.apyLabel === null ? (
            <Skeleton width="3rem" height="1rem" />
          ) : (
            <span className="text-sm font-semibold text-[var(--primary)] whitespace-nowrap">
              {summary.apyLabel}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2">
        {showYourPosition && (
          <MobileStatBlock label="Your Position">
            <FamilyPositionValue summary={summary} align="start" />
          </MobileStatBlock>
        )}
        <MobileStatBlock label="Deposits">
          <ValueCell
            rawValue={leadData?.totalAssets}
            usdValue={leadData?.totalDeposits}
            decimals={decimals}
            symbol={lead.symbol}
            loading={loading}
            align="start"
          />
        </MobileStatBlock>
        <MobileStatBlock label="Liquidity">
          <ValueCell
            rawValue={resolveTotalUnderlyingLiquidityAssets(
              leadData?.liquidityBreakdown,
              leadData?.liquidityAssets ?? leadData?.totalAssets
            )}
            usdValue={resolveTotalUnderlyingLiquidityUsd(
              leadData?.liquidityBreakdown,
              leadData?.currentLiquidity
            )}
            decimals={decimals}
            symbol={lead.symbol}
            loading={loading}
            align="start"
          />
        </MobileStatBlock>
      </div>
    </div>
  );
}

/**
 * Family expand state. A family starts open when the wallet holds every vault in it, so each
 * vault's own numbers show under the combined row; a tap toggles it.
 */
function useFamilyExpansion(families: VaultFamily[]) {
  const { morphoHoldings } = useWallet();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const heldKeys = useMemo(() => {
    const held = new Set(
      morphoHoldings.positions
        .filter((position) => hasOnChainVaultShares(position))
        .map((position) => position.vault.address.toLowerCase())
    );
    return new Set(
      families
        .filter(
          (family) =>
            family.members.length > 1 &&
            family.members.every((member) => held.has(member.address.toLowerCase()))
        )
        .map((family) => family.key)
    );
  }, [families, morphoHoldings.positions]);

  const isExpanded = (family: VaultFamily) => overrides[family.key] ?? heldKeys.has(family.key);
  const toggle = (family: VaultFamily) =>
    setOverrides((prev) => ({ ...prev, [family.key]: !isExpanded(family) }));
  return { isExpanded, toggle };
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
  const kindMarks = useMemo(() => selectVaultKindMarkAddresses(vaults), [vaults]);
  const { blockedVaultAddresses } = useVaultDepositGates();
  const isRestricted = (vault: Vault) => blockedVaultAddresses.has(vault.address.toLowerCase());
  const families = useMemo(() => groupVaultFamilies(vaults), [vaults]);
  const { isExpanded, toggle } = useFamilyExpansion(families);

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
        {families.map((family) => {
          const renderCard = (vault: Vault, nested: boolean) => (
            <VaultExplorerMobileCard
              key={vault.address}
              vault={vault}
              showYourPosition={showYourPosition}
              showKind={kindMarks.has(vault.address.toLowerCase())}
              restricted={isRestricted(vault)}
              nested={nested}
            />
          );
          if (family.members.length === 1) return renderCard(family.members[0], false);
          const expanded = isExpanded(family);
          return (
            <div key={family.key}>
              <VaultFamilyMobileCard
                family={family}
                expanded={expanded}
                onToggle={() => toggle(family)}
                showYourPosition={showYourPosition}
              />
              {expanded ? family.members.map((vault) => renderCard(vault, true)) : null}
            </div>
          );
        })}
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
          {families.flatMap((family) => {
            const renderRow = (vault: Vault, nested: boolean) => (
              <VaultExplorerRow
                key={vault.address}
                vault={vault}
                showYourPosition={showYourPosition}
                showKind={kindMarks.has(vault.address.toLowerCase())}
                restricted={isRestricted(vault)}
                nested={nested}
              />
            );
            if (family.members.length === 1) return [renderRow(family.members[0], false)];
            const expanded = isExpanded(family);
            return [
              <VaultFamilyRow
                key={`family-${family.key}`}
                family={family}
                expanded={expanded}
                onToggle={() => toggle(family)}
                showYourPosition={showYourPosition}
              />,
              ...(expanded ? family.members.map((vault) => renderRow(vault, true)) : []),
            ];
          })}
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

function DashboardVaultColGroup() {
  return (
    <colgroup>
      <col className="w-[34%]" />
      <col className="w-[22%]" />
      <col className="w-[22%]" />
      <col className="w-[22%]" />
    </colgroup>
  );
}

const DASHBOARD_HEAD_CELL =
  'px-2 py-2 text-xs font-medium leading-tight whitespace-nowrap text-[var(--foreground-secondary)]';
const DASHBOARD_VALUE_CELL = 'px-2 py-2.5 align-middle text-right';

function DashboardVaultTableHead() {
  return (
    <thead>
      <tr className="border-b border-[var(--border)] text-left">
        <th className={DASHBOARD_HEAD_CELL}>Vault</th>
        <th className={`${DASHBOARD_HEAD_CELL} text-right`}>Your Position</th>
        <th className={`${DASHBOARD_HEAD_CELL} text-right`}>Earned Interest</th>
        <th className={`${DASHBOARD_HEAD_CELL} text-right`}>APY / TVL</th>
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
          <DashboardVaultColGroup />
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

/** One dashboard vault row: this contract's own position, profit, APY and TVL. */
function DashboardVaultRow({
  vault,
  showKind,
  nested = false,
}: {
  vault: Vault;
  showKind: boolean;
  nested?: boolean;
}) {
  const router = useRouter();
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const { getVaultData, isLoading } = useVaultData();
  const vaultData = getVaultData(vault.address) as MorphoVaultData | null;
  const loading = isLoading(vault.address);
  const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
  const position = morphoHoldings.positions.find(
    (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
  );
  const positionUsd = position
    ? resolvePositionAssetsUsd(position, { assetDecimals: decimals, symbol: vault.symbol })
    : 0;
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
      onKeyDown={isCurated ? (event) => handleRowKeyDown(event, openVault) : undefined}
      className={`border-b border-[var(--border)] transition-colors ${
        isCurated ? 'hover:bg-[var(--surface-hover)] cursor-pointer' : 'cursor-default'
      }`}
    >
      <td className="px-2 py-2.5 align-middle">
        <div className={`flex items-start gap-2 min-w-0 ${nested ? 'ml-3 pl-3 border-l border-[var(--border)]' : ''}`}>
          <VaultLogo vault={vault} size={nested ? 22 : 28} />
          <div className="min-w-0 flex-1">
            <VaultName name={vault.name} lines={2} kind={vault.kind} showKind={showKind} />
            <VaultShareLabel vault={vault} />
          </div>
        </div>
      </td>
      <td className={DASHBOARD_VALUE_CELL}>
        {!address || morphoHoldings.isLoading ? (
          <Skeleton width="4.5rem" height="1rem" className="ml-auto" />
        ) : hasOnChainVaultShares(position) ? (
          <DashboardTokenValue
            rawValue={position?.assets}
            decimals={decimals}
            symbol={vault.symbol}
            usd={positionUsd}
          />
        ) : (
          <span className="text-sm text-[var(--foreground-muted)]">-</span>
        )}
      </td>
      <td className={DASHBOARD_VALUE_CELL}>
        <EarnedInterestCell vault={vault} decimals={decimals} />
      </td>
      <td className={DASHBOARD_VALUE_CELL}>
        {loading || !vaultData ? (
          <Skeleton width="4rem" height="1rem" className="ml-auto" />
        ) : (
          <DashboardApyTvlValue vaultData={vaultData} />
        )}
      </td>
    </tr>
  );
}

/** Dashboard family row: both contracts' position and profit, the underlying's TVL, the APY range. */
function DashboardFamilyRow({
  family,
  expanded,
  onToggle,
}: {
  family: VaultFamily;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = useFamilySummary(family);
  const { lead, leadData, decimals } = summary;

  return (
    <tr
      {...familyToggleProps(lead.name, expanded, onToggle)}
      className="border-b border-[var(--border)] transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
    >
      <td className="px-2 py-2.5 align-middle">
        <div className="flex items-start gap-1.5 min-w-0">
          <span className="mt-2">
            <FamilyChevron expanded={expanded} />
          </span>
          <VaultLogo vault={lead} size={28} />
          <div className="min-w-0 flex-1">
            <VaultName name={lead.name} lines={2} />
            <FamilyKinds family={family} />
          </div>
        </div>
      </td>
      <td className={DASHBOARD_VALUE_CELL}>
        <FamilyDashboardPosition summary={summary} />
      </td>
      <td className={DASHBOARD_VALUE_CELL}>
        <EarnedInterestCell vault={lead} decimals={decimals} combinePair />
      </td>
      <td className={DASHBOARD_VALUE_CELL}>
        <FamilyApyTvl summary={summary} leadData={leadData} />
      </td>
    </tr>
  );
}

function FamilyDashboardPosition({
  summary,
  align = 'end',
}: {
  summary: ReturnType<typeof useFamilySummary>;
  align?: 'start' | 'end';
}) {
  const { address } = useAccount();
  if (!address || summary.holdingsLoading) {
    return <Skeleton width="4.5rem" height="1rem" className={align === 'end' ? 'ml-auto' : ''} />;
  }
  if (!summary.held) return <span className="text-sm text-[var(--foreground-muted)]">-</span>;
  return (
    <DashboardTokenValue
      rawValue={summary.positionRaw}
      decimals={summary.decimals}
      symbol={summary.lead.symbol}
      usd={summary.positionUsd}
      align={align}
    />
  );
}

function FamilyApyTvl({
  summary,
  leadData,
  align = 'end',
}: {
  summary: ReturnType<typeof useFamilySummary>;
  leadData: MorphoVaultData | null;
  align?: 'start' | 'end';
}) {
  if (summary.apyLabel === null || !leadData) {
    return <Skeleton width="4rem" height="1rem" className={align === 'end' ? 'ml-auto' : ''} />;
  }
  return (
    <DashboardStackedValue
      align={align}
      primaryClassName="font-semibold text-[var(--primary)]"
      primary={`${summary.apyLabel} APY`}
      secondary={`${formatSmartCurrency(leadData.totalValueLocked || 0, { alwaysTwoDecimals: true })} TVL`}
    />
  );
}

function DashboardFamilyMobileCard({
  family,
  expanded,
  onToggle,
}: {
  family: VaultFamily;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = useFamilySummary(family);
  const { lead, leadData, decimals } = summary;

  return (
    <div
      {...familyToggleProps(lead.name, expanded, onToggle)}
      className="w-full text-left px-3 py-3 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer"
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <FamilyChevron expanded={expanded} />
          <VaultLogo vault={lead} />
        </div>
        <div className="min-w-0 flex-1">
          <VaultName name={lead.name} lines={2} />
          <FamilyKinds family={family} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MobileStatBlock label="Your Position">
          <FamilyDashboardPosition summary={summary} align="start" />
        </MobileStatBlock>
        <MobileStatBlock label="Earned Interest">
          <EarnedInterestCell vault={lead} decimals={decimals} align="start" combinePair />
        </MobileStatBlock>
        <MobileStatBlock label="APY / TVL">
          <FamilyApyTvl summary={summary} leadData={leadData} align="start" />
        </MobileStatBlock>
      </div>
    </div>
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
  const kindMarks = useMemo(() => selectVaultKindMarkAddresses(vaults), [vaults]);

  // A pair held on both sides is one family row (sorted by its combined value) with each
  // vault under it; everything else is a plain row.
  const families = useMemo(() => {
    const usdOf = (vault: Vault) => {
      const position = morphoHoldings.positions.find(
        (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
      );
      return position ? resolvePositionAssetsUsd(position) : 0;
    };
    return groupVaultFamilies(vaults)
      .map((family, index) => ({
        family,
        index,
        usd: family.members.reduce((sum, vault) => sum + usdOf(vault), 0),
      }))
      .sort((a, b) => b.usd - a.usd || a.index - b.index)
      .map(({ family }) => family);
  }, [vaults, morphoHoldings.positions]);
  const { isExpanded, toggle } = useFamilyExpansion(families);
  const hasExternal = vaults.some((vault) => !isCuratedVaultAddress(vault.address));

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
              <DashboardVaultColGroup />
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

  const renderMobileCard = (vault: Vault, nested: boolean) => {
    const vaultData = getVaultData(vault.address) as MorphoVaultData | null;
    const decimals = resolveAssetDecimals(vault.symbol, vaultData?.assetDecimals);
    const position = morphoHoldings.positions.find(
      (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
    );
    return (
      <DashboardVaultMobileCard
        key={vault.address}
        vault={vault}
        positionAssets={position?.assets}
        positionUsd={
          position
            ? resolvePositionAssetsUsd(position, { assetDecimals: decimals, symbol: vault.symbol })
            : 0
        }
        loading={isLoading(vault.address)}
        vaultData={vaultData}
        showKind={kindMarks.has(vault.address.toLowerCase())}
        nested={nested}
        showCuratedLabel={hasExternal}
      />
    );
  };

  return (
    // Container width (not viewport): half-column dashboards stay on cards until wide enough for the table.
    <div className="@container min-w-0">
      <div className="@min-[640px]:hidden">
        {families.map((family) => {
          if (family.members.length === 1) return renderMobileCard(family.members[0], false);
          const expanded = isExpanded(family);
          return (
            <div key={family.key}>
              <DashboardFamilyMobileCard
                family={family}
                expanded={expanded}
                onToggle={() => toggle(family)}
              />
              {expanded ? family.members.map((vault) => renderMobileCard(vault, true)) : null}
            </div>
          );
        })}
      </div>

      <div className="hidden @min-[640px]:block min-w-0">
      <table className="w-full table-fixed">
        <DashboardVaultColGroup />
        <DashboardVaultTableHead />
        <tbody>
          {families.flatMap((family) => {
            const renderRow = (vault: Vault, nested: boolean) => (
              <DashboardVaultRow
                key={vault.address}
                vault={vault}
                showKind={kindMarks.has(vault.address.toLowerCase())}
                nested={nested}
              />
            );
            if (family.members.length === 1) return [renderRow(family.members[0], false)];
            const expanded = isExpanded(family);
            return [
              <DashboardFamilyRow
                key={`family-${family.key}`}
                family={family}
                expanded={expanded}
                onToggle={() => toggle(family)}
              />,
              ...(expanded ? family.members.map((vault) => renderRow(vault, true)) : []),
            ];
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
