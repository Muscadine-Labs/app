'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Vault, getVaultLogo } from '@/types/vault';
import type { MorphoVaultData } from '@/types/vault';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useWallet } from '@/contexts/WalletContext';
import { getVaultRoute } from '@/lib/vault-utils';
import { formatNumber, formatPercentage, formatSmartCurrency } from '@/lib/formatter';
import { formatUnits } from 'viem';
import { Skeleton } from '@/components/ui/Skeleton';
import { useIsClient } from '@/hooks/useClientOnly';

function formatCompactTokenAmount(rawValue: string | undefined, decimals: number, symbol: string): string {
  if (!rawValue) return `0 ${symbol}`;

  const value = Number(formatUnits(BigInt(rawValue), decimals));
  if (!Number.isFinite(value) || value === 0) return `0 ${symbol}`;

  const absValue = Math.abs(value);
  let formatted: string;

  if (absValue >= 1_000_000_000) {
    formatted = `${formatNumber(value / 1_000_000_000, { maximumFractionDigits: 2 })}B`;
  } else if (absValue >= 1_000_000) {
    formatted = `${formatNumber(value / 1_000_000, { maximumFractionDigits: 2 })}M`;
  } else if (absValue >= 1_000) {
    formatted = `${formatNumber(value / 1_000, { maximumFractionDigits: 2 })}K`;
  } else {
    formatted = formatNumber(value, { maximumFractionDigits: 2 });
  }

  return `${formatted} ${symbol}`;
}

function ValueCell({
  rawValue,
  usdValue,
  decimals,
  symbol,
  loading,
}: {
  rawValue?: string;
  usdValue?: number;
  decimals: number;
  symbol: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Skeleton width="5rem" height="1rem" />
        <Skeleton width="4rem" height="0.875rem" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
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
}: {
  vault: Vault;
  loading: boolean;
}) {
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const { address } = useAccount();

  const vaultData = getVaultData(vault.address);
  const position = morphoHoldings.positions.find(
    (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
  );
  const positionUsd = position?.assetsUsd ?? 0;
  const decimals = vaultData?.assetDecimals ?? (vault.symbol === 'USDC' ? 6 : 18);
  const positionRaw = position?.assets
    ? formatCompactTokenAmount(position.assets, decimals, vault.symbol)
    : '-';

  if (!address || loading || morphoHoldings.isLoading) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Skeleton width="5rem" height="1rem" />
        <Skeleton width="4rem" height="0.875rem" />
      </div>
    );
  }

  if (positionUsd <= 0) {
    return <span className="text-sm text-[var(--foreground-muted)]">-</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-sm font-medium text-[var(--foreground)]">{positionRaw}</span>
      <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--foreground-secondary)]">
        {formatSmartCurrency(positionUsd, { alwaysTwoDecimals: true })}
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
  const decimals = vaultData?.assetDecimals ?? (vault.symbol === 'USDC' ? 6 : 18);

  const handleClick = () => {
    router.push(getVaultRoute(vault.address));
  };

  return (
    <tr
      onClick={handleClick}
      className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
    >
      <td className="px-4 sm:px-6 py-4 align-middle">
        <span className="inline-flex rounded-md bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--foreground-secondary)]">
          Base
        </span>
      </td>

      <td className="px-4 sm:px-6 py-4 align-middle">
        <div className="flex items-center gap-3 min-w-[180px]">
          <div className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden bg-white">
            <Image
              src={getVaultLogo(vault.symbol)}
              alt={`${vault.symbol} logo`}
              width={32}
              height={32}
              className={`object-contain ${vault.symbol === 'WETH' ? 'scale-75' : ''}`}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--foreground)] truncate">{vault.name}</span>
              <span className="inline-flex rounded-md bg-[var(--primary-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary)]">
                {vault.version}
              </span>
            </div>
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
          rawValue={vaultData?.liquidityAssets ?? vaultData?.totalAssets}
          usdValue={vaultData?.currentLiquidity}
          decimals={decimals}
          symbol={vault.symbol}
          loading={loading}
        />
      </td>

      <td className="px-4 sm:px-6 py-4 align-middle text-right">
        {loading || !vaultData ? (
          <Skeleton width="3rem" height="1rem" className="ml-auto" />
        ) : (
          <span className="text-sm font-semibold text-[var(--primary)]">
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
    <div className="overflow-x-auto">
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
            <VaultExplorerRow key={vault.address} vault={vault} showYourPosition={showYourPosition} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Compact table for dashboard with Your Position column
interface DashboardVaultTableProps {
  vaults: Vault[];
  emptyMessage?: string;
  showBrowseLink?: boolean;
}

export function DashboardVaultTable({
  vaults,
  emptyMessage = 'No vault deposits yet.',
  showBrowseLink = false,
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
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">{emptyMessage}</p>
        {showBrowseLink && (
          <button
            type="button"
            onClick={() => router.push('/vaults')}
            className="mt-3 text-sm text-[var(--primary)] hover:underline cursor-pointer"
          >
            Browse available vaults
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)]">Vault</th>
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)] text-right">Your Position</th>
            <th className="px-4 sm:px-6 py-3 text-xs font-medium text-[var(--foreground-secondary)] text-right">APY / TVL</th>
          </tr>
        </thead>
        <tbody>
          {vaults.map((vault) => {
            const vaultData = getVaultData(vault.address) as MorphoVaultData | null;
            const loading = isLoading(vault.address);
            const position = morphoHoldings.positions.find(
              (item) => item.vault.address.toLowerCase() === vault.address.toLowerCase()
            );
            const positionUsd = position?.assetsUsd ?? 0;
            const decimals = vaultData?.assetDecimals ?? (vault.symbol === 'USDC' ? 6 : 18);
            const positionRaw = position?.assets
              ? formatCompactTokenAmount(position.assets, decimals, vault.symbol)
              : '-';

            return (
              <tr
                key={vault.address}
                onClick={() => router.push(getVaultRoute(vault.address))}
                className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                <td className="px-4 sm:px-6 py-4 align-middle">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden bg-white">
                      <Image
                        src={getVaultLogo(vault.symbol)}
                        alt={`${vault.symbol} logo`}
                        width={32}
                        height={32}
                        className={`object-contain ${vault.symbol === 'WETH' ? 'scale-75' : ''}`}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-[var(--foreground)]">{vault.name}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 sm:px-6 py-4 align-middle text-right">
                  {!address || loading || morphoHoldings.isLoading ? (
                    <Skeleton width="5rem" height="1rem" className="ml-auto" />
                  ) : positionUsd > 0 ? (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-medium text-[var(--foreground)]">{positionRaw}</span>
                      <span className="text-xs text-[var(--foreground-secondary)]">
                        {formatSmartCurrency(positionUsd, { alwaysTwoDecimals: true })}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--foreground-muted)]">-</span>
                  )}
                </td>
                <td className="px-4 sm:px-6 py-4 align-middle text-right">
                  {loading || !vaultData ? (
                    <Skeleton width="4rem" height="1rem" className="ml-auto" />
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-semibold text-[var(--primary)]">
                        {formatPercentage(vaultData.apy)} APY
                      </span>
                      <span className="text-xs text-[var(--foreground-secondary)]">
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
  );
}
