'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  buildCashHoldings,
  buildCryptoAssetHoldings,
  buildExtraWalletTokenHoldings,
  getAssetRoute,
  getAssetUiName,
  getAssetUiSymbol,
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

function CashGlyph() {
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold bg-[var(--primary-subtle)] text-[var(--primary)] border border-[var(--border)]"
      aria-hidden
    >
      $
    </div>
  );
}

export default function DashboardTokensPanel({
  variant = 'crypto',
}: {
  variant?: 'cash' | 'crypto';
}) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { tokenBalances, morphoHoldings, loading } = useWallet();

  const cashHoldings = useMemo(
    () => buildCashHoldings(tokenBalances, morphoHoldings.positions),
    [tokenBalances, morphoHoldings.positions]
  );

  const cryptoHoldings = useMemo(
    () => buildCryptoAssetHoldings(tokenBalances, morphoHoldings.positions),
    [tokenBalances, morphoHoldings.positions]
  );

  const extraTokens = useMemo(
    () => (variant === 'crypto' ? buildExtraWalletTokenHoldings(tokenBalances) : []),
    [tokenBalances, variant]
  );

  const holdings = variant === 'cash' ? cashHoldings : cryptoHoldings;

  const rows: DashboardAssetRow[] = useMemo(() => {
    const assetRows: DashboardAssetRow[] = holdings.map((holding) => {
      const symbol = getAssetUiSymbol(holding.asset);
      const vaultAddresses = holding.vaultParts.map((part) => part.address);
      return {
        key: holding.asset.slug,
        name: getAssetUiName(holding.asset),
        symbol,
        icon:
          holding.asset.slug === 'usdc' ? (
            <CashGlyph />
          ) : (
            <Image
              src={holding.logo}
              alt={symbol}
              width={28}
              height={28}
              className="rounded-full shrink-0"
            />
          ),
        positionRaw: holding.totalRaw.toString(),
        positionDecimals: holding.asset.decimals,
        positionSymbol: symbol,
        positionUsd: holding.totalUsd,
        earnedRaw: sumPositivePnlRaw(morphoHoldings.positions, vaultAddresses).toString(),
        earnedDecimals: holding.asset.decimals,
        earnedSymbol: symbol,
        earnedUsd: sumPositivePnlUsd(morphoHoldings.positions, vaultAddresses),
        onActivate: () => router.push(getAssetRoute(holding.asset.slug)),
      };
    });

    const extraRows: DashboardAssetRow[] = extraTokens.map((token) => ({
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

    return [...assetRows, ...extraRows];
  }, [extraTokens, holdings, morphoHoldings.positions, router]);

  if (!isConnected) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">
          Connect a wallet to see {variant === 'cash' ? 'cash' : 'token'} balances.
        </p>
      </div>
    );
  }

  if (loading || morphoHoldings.isLoading) {
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
      emptyMessage={
        variant === 'cash'
          ? 'No USD / stablecoins in wallet or vaults yet.'
          : 'No crypto in wallet or vaults yet.'
      }
    />
  );
}
