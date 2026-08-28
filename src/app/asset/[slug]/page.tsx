'use client';

import Image from 'next/image';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useIsClient } from '@/hooks/useClientOnly';
import { useWallet } from '@/contexts/WalletContext';
import { usePrices } from '@/contexts/PriceContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { Skeleton } from '@/components/ui/Skeleton';
import { DashboardVaultTable } from '@/components/features/vault/VaultExplorerTable';
import {
  buildAssetHolding,
  getAssetBySlug,
  getAssetRoute,
  getVaultsForAssetPage,
} from '@/lib/assets';
import { getVaultLogo, type Vault } from '@/types/vault';
import { formatCurrency, formatAssetAmount } from '@/lib/formatter';
import {
  getVaultRoute,
  isCuratedVaultAddress,
  resolvePositionAssetsUsd,
  sortVaultsForDisplay,
} from '@/lib/vault-utils';
import type { MorphoVaultData } from '@/types/vault';

function formatAmount(raw: bigint, decimals: number, symbol: string): string {
  return formatAssetAmount(raw, decimals, symbol);
}

function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg bg-[var(--surface)] overflow-hidden flex flex-col min-h-[320px] min-w-0 ${className}`}
    >
      <div className="px-4 sm:px-5 py-3 border-b border-[var(--border)] shrink-0">
        <h2 className="text-sm sm:text-base text-[var(--foreground)]">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
    </div>
  );
}

export default function AssetPage() {
  const params = useParams();
  const router = useRouter();
  const slug = (params?.slug as string) || '';
  const asset = getAssetBySlug(slug);
  const isMounted = useIsClient();
  const { isConnected } = useAccount();
  const { tokenBalances, morphoHoldings, loading } = useWallet();
  const { eth, btc, loading: pricesLoading } = usePrices();
  const { getVaultData } = useVaultData();

  // Canonicalize aliases (e.g. /asset/cbbtc → /asset/btc)
  useEffect(() => {
    if (!slug || !asset) return;
    if (slug.trim().toLowerCase() !== asset.slug) {
      router.replace(getAssetRoute(asset.slug));
    }
  }, [slug, asset, router]);

  const holding = useMemo(() => {
    if (!asset) return null;
    return buildAssetHolding(asset, tokenBalances, morphoHoldings.positions);
  }, [asset, tokenBalances, morphoHoldings.positions]);

  const relatedVaults: Vault[] = useMemo(() => {
    if (!asset) return [];
    const vaults = getVaultsForAssetPage(asset, morphoHoldings.positions);
    return sortVaultsForDisplay(
      vaults,
      morphoHoldings.positions,
      (addr) => {
        const position = morphoHoldings.positions.find(
          (p) => p.vault.address.toLowerCase() === addr.toLowerCase()
        );
        if (position) return resolvePositionAssetsUsd(position);
        const data = getVaultData(addr) as MorphoVaultData | null;
        return data?.totalValueLocked ?? 0;
      }
    );
  }, [asset, morphoHoldings.positions, getVaultData]);

  useVaultListPreloader(relatedVaults);

  if (!asset) {
    return (
      <div className="w-full min-h-full p-4 sm:p-6 md:p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--foreground-secondary)]">Asset not found.</p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="text-sm text-[var(--primary)] hover:underline cursor-pointer"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const spotPrice =
    holding && holding.priceUsd > 0
      ? holding.priceUsd
      : asset.slug === 'usdc'
        ? 1
        : asset.slug === 'eth'
          ? eth ?? 0
          : btc ?? 0;

  if (!isMounted) {
    return (
      <div className="w-full min-h-full p-4 sm:p-6 md:p-8 space-y-6">
        <Skeleton width="8rem" height="1.5rem" />
        <Skeleton width="14rem" height="2.5rem" />
        <div className="grid grid-cols-1 min-[800px]:grid-cols-5 gap-3 sm:gap-4">
          <Skeleton width="100%" height="20rem" className="min-[800px]:col-span-2" />
          <Skeleton width="100%" height="20rem" className="min-[800px]:col-span-3" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[var(--background)] min-h-full p-4 sm:p-6 md:p-8 pb-12">
      <button
        type="button"
        onClick={() => router.push('/')}
        className="text-sm text-[var(--foreground-secondary)] hover:text-[var(--foreground)] mb-4 cursor-pointer"
      >
        ← Dashboard
      </button>

      <div className="rounded-lg bg-[var(--surface)] px-4 sm:px-5 py-3 sm:py-4 mb-3 sm:mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Image
              src={holding?.logo ?? getVaultLogo(asset.displaySymbol)}
              alt={asset.displaySymbol}
              width={40}
              height={40}
              className="rounded-full shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-[var(--foreground)] leading-tight truncate">
                {asset.displaySymbol}
              </h1>
              <p className="text-sm text-[var(--foreground-secondary)] truncate">{asset.name}</p>
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end shrink-0">
            <span className="text-sm text-[var(--foreground-secondary)]">Price</span>
            {pricesLoading && spotPrice <= 0 ? (
              <Skeleton width="5rem" height="1.75rem" />
            ) : (
              <span className="text-2xl md:text-3xl font-bold tabular-nums">
                {formatCurrency(spotPrice)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 min-[800px]:grid-cols-5 gap-3 sm:gap-4 items-stretch">
        <Panel
          title="Your total"
          subtitle="Wallet + vaults combined"
          className="min-[800px]:col-span-2 h-full min-h-[360px]"
        >
          <div className="px-4 sm:px-5 py-4 space-y-4">
            {!isConnected || !holding ? (
              <p className="text-sm text-[var(--foreground-muted)]">
                Connect a wallet to view holdings.
              </p>
            ) : loading || morphoHoldings.isLoading ? (
              <div className="space-y-3">
                <Skeleton width="10rem" height="2rem" />
                <Skeleton width="100%" height="1rem" />
                <Skeleton width="100%" height="1rem" />
              </div>
            ) : (
              <>
                <div>
                  <div className="text-2xl md:text-3xl font-bold tabular-nums leading-none">
                    {formatAmount(holding.totalRaw, asset.decimals, asset.displaySymbol)}
                  </div>
                  <div className="text-sm text-[var(--foreground-secondary)] tabular-nums mt-1">
                    {formatCurrency(holding.totalUsd)}
                  </div>
                </div>

                <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
                  <div className="text-xs font-medium text-[var(--foreground-secondary)]">
                    Wallet
                  </div>
                  {holding.liquidParts.map((part) => (
                    <BreakdownRow
                      key={part.symbol}
                      label={part.symbol}
                      amount={formatAmount(part.raw, part.decimals, part.symbol)}
                      usd={formatCurrency(part.usd)}
                    />
                  ))}
                </div>

                <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
                  <div className="text-xs font-medium text-[var(--foreground-secondary)]">
                    In vaults
                  </div>
                  {holding.vaultParts.length === 0 ? (
                    <p className="text-sm text-[var(--foreground-muted)]">No vault deposits</p>
                  ) : (
                    holding.vaultParts.map((part) => {
                      const open = isCuratedVaultAddress(part.address)
                        ? () => router.push(getVaultRoute(part.address))
                        : undefined;
                      return open ? (
                        <button
                          key={part.address}
                          type="button"
                          onClick={open}
                          className="w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
                        >
                          <BreakdownRow
                            label={`${part.name} · Whitelisted`}
                            amount={formatAmount(part.raw, part.decimals, asset.displaySymbol)}
                            usd={formatCurrency(part.usd)}
                          />
                        </button>
                      ) : (
                        <div key={part.address}>
                          <BreakdownRow
                            label={`${part.name} · External`}
                            amount={formatAmount(part.raw, part.decimals, asset.displaySymbol)}
                            usd={formatCurrency(part.usd)}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </Panel>

        <Panel
          title="Vaults"
          subtitle={`${asset.displaySymbol} vaults · whitelisted open; external listed only`}
          className="min-[800px]:col-span-3 h-full min-h-[360px]"
        >
          <DashboardVaultTable
            vaults={relatedVaults}
            emptyMessage={`No vaults for ${asset.displaySymbol} yet.`}
          />
        </Panel>
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  amount,
  usd,
}: {
  label: string;
  amount: string;
  usd: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--foreground)] truncate">{label}</span>
      <div className="flex flex-col items-end shrink-0">
        <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">{amount}</span>
        <span className="text-xs tabular-nums text-[var(--foreground-secondary)]">{usd}</span>
      </div>
    </div>
  );
}
