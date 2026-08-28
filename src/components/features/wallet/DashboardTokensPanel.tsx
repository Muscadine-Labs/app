'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  getAssetRoute,
  type DashboardTokenHoldings,
} from '@/lib/assets';
import { sumPositivePnlRaw, sumPositivePnlUsd } from '@/lib/vault-utils';
import DashboardAssetTable, {
  type DashboardAssetRow,
} from './DashboardAssetTable';

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

export default function DashboardTokensPanel({
  holdings,
}: {
  holdings: DashboardTokenHoldings;
}) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { morphoHoldings, loading } = useWallet();

  const rows: DashboardAssetRow[] = useMemo(() => {
    const assetRows: DashboardAssetRow[] = holdings.curated.map((holding) => {
      const vaultAddresses = holding.vaultParts.map((part) => part.address);
      return {
        key: holding.asset.slug,
        name: holding.asset.name,
        symbol: holding.asset.displaySymbol,
        icon: (
          <Image
            src={holding.logo}
            alt={holding.asset.displaySymbol}
            width={28}
            height={28}
            className="rounded-full shrink-0"
          />
        ),
        positionRaw: holding.totalRaw.toString(),
        positionDecimals: holding.asset.decimals,
        positionSymbol: holding.asset.displaySymbol,
        positionUsd: holding.totalUsd,
        earnedRaw: sumPositivePnlRaw(morphoHoldings.positions, vaultAddresses).toString(),
        earnedDecimals: holding.asset.decimals,
        earnedSymbol: holding.asset.displaySymbol,
        earnedUsd: sumPositivePnlUsd(morphoHoldings.positions, vaultAddresses),
        onActivate: () => router.push(getAssetRoute(holding.asset.slug)),
      };
    });

    const extraRows: DashboardAssetRow[] = holdings.extras.map((token) => ({
      key: `${token.address}-${token.symbol}`,
      name: token.symbol,
      symbol: token.symbol,
      icon: <TokenGlyph symbol={token.symbol} />,
      positionRaw: token.raw.toString(),
      positionDecimals: token.decimals,
      positionSymbol: token.symbol,
      positionUsd: token.usd,
      earnedRaw: '0',
      earnedDecimals: token.decimals,
      earnedSymbol: token.symbol,
      earnedUsd: 0,
    }));

    const stockRows: DashboardAssetRow[] = holdings.stocks.map((holding) => ({
      key: `${holding.address}-${holding.symbol}`,
      name: holding.name,
      symbol: holding.symbol,
      icon: <TokenGlyph symbol={holding.symbol} />,
      positionRaw: holding.raw.toString(),
      positionDecimals: holding.decimals,
      positionSymbol: holding.symbol,
      positionUsd: holding.usd,
      earnedRaw: '0',
      earnedDecimals: holding.decimals,
      earnedSymbol: holding.symbol,
      earnedUsd: 0,
    }));

    return [...assetRows, ...extraRows, ...stockRows];
  }, [holdings, morphoHoldings.positions, router]);

  if (!isConnected) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">
          Connect a wallet to see token balances.
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
      emptyMessage="No tokens in wallet or vaults yet."
    />
  );
}
