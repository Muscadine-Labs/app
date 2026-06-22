import { NextRequest, NextResponse } from 'next/server';
import type { GraphQLResponse } from '@/types/api';
import {
  getAssetDecimalsForSymbol,
  morphoAmountToDecimal,
  morphoAmountToRaw,
} from '@/lib/asset-decimals';
import { isValidEthereumAddress, findVaultByAddress } from '@/lib/vault-utils';
import { isValidChainId } from '@/lib/api-utils';
import { computeEarnedInterestFromActivity } from '@/lib/interest-utils';
import { logger } from '@/lib/logger';

interface VaultV2PositionData {
  assets: number | string;
  assetsUsd: number;
  shares: number | string;
  pnl?: number | string;
  pnlUsd?: number;
  vault?: {
    asset?: { symbol?: string; decimals?: number };
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || '8453';
  const userAddress = searchParams.get('userAddress');

  const { address: vaultAddress } = await params;

  if (!userAddress || !isValidEthereumAddress(userAddress)) {
    return NextResponse.json({ error: 'userAddress required' }, { status: 400 });
  }

  if (!isValidEthereumAddress(vaultAddress)) {
    return NextResponse.json({ error: 'Invalid vault address' }, { status: 400 });
  }

  if (!isValidChainId(chainIdParam)) {
    return NextResponse.json({ error: 'Invalid chain ID' }, { status: 400 });
  }

  const chainId = parseInt(chainIdParam, 10);

  try {
    const positionQuery = `
      query VaultV2PositionPnl($userAddress: String!, $vaultAddress: String!, $chainId: Int!) {
        vaultV2PositionByAddress(
          userAddress: $userAddress
          vaultAddress: $vaultAddress
          chainId: $chainId
        ) {
          assets
          assetsUsd
          shares
          pnl
          pnlUsd
          vault {
            asset {
              symbol
              decimals
            }
          }
        }
      }
    `;

    const positionResponse = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: positionQuery,
        variables: { userAddress, vaultAddress, chainId },
      }),
      next: { revalidate: 60 },
    });

    const positionJson = (await positionResponse.json()) as GraphQLResponse<{
      vaultV2PositionByAddress: VaultV2PositionData | null;
    }>;

    const position = positionJson.data?.vaultV2PositionByAddress;
    const registryVault = findVaultByAddress(vaultAddress);
    const assetSymbol =
      registryVault?.symbol ??
      position?.vault?.asset?.symbol ??
      'UNKNOWN';
    const assetDecimals =
      position?.vault?.asset?.decimals ??
      getAssetDecimalsForSymbol(assetSymbol);

    if (position?.pnl !== undefined && position.pnl !== null) {
      return NextResponse.json({
        earnedInterest: morphoAmountToDecimal(position.pnl, assetDecimals),
        earnedInterestUsd: position.pnlUsd ?? 0,
        earnedInterestRaw: morphoAmountToRaw(position.pnl),
        assetDecimals,
        source: 'morpho-pnl',
        currentAssets: morphoAmountToDecimal(position.assets, assetDecimals),
        currentAssetsUsd: position.assetsUsd,
      });
    }

    const activityUrl = new URL(request.url);
    activityUrl.pathname = `/api/vault/v2/${vaultAddress}/activity`;
    activityUrl.searchParams.set('userAddress', userAddress);
    activityUrl.searchParams.set('chainId', String(chainId));

    const activityResponse = await fetch(activityUrl.toString());
    if (!activityResponse.ok) {
      return NextResponse.json({
        earnedInterest: 0,
        earnedInterestUsd: 0,
        earnedInterestRaw: '0',
        assetDecimals,
        source: 'none',
      });
    }

    const activity = await activityResponse.json();
    const resolvedDecimals = activity.assetDecimals ?? assetDecimals;

    const currentAssetsRaw = position
      ? BigInt(morphoAmountToRaw(position.assets))
      : BigInt(0);

    const earnedRaw = computeEarnedInterestFromActivity({
      currentAssetsRaw,
      deposits: activity.deposits ?? [],
      withdrawals: activity.withdrawals ?? [],
    });

    const earnedDecimal = Number(earnedRaw) / 10 ** resolvedDecimals;
    const positionAssetsDecimal = position
      ? morphoAmountToDecimal(position.assets, resolvedDecimals)
      : 0;
    const assetPriceUsd =
      activity.assetPriceUsd ??
      (position && positionAssetsDecimal > 0
        ? position.assetsUsd / positionAssetsDecimal
        : 0);

    return NextResponse.json({
      earnedInterest: earnedDecimal,
      earnedInterestUsd: earnedDecimal * assetPriceUsd,
      earnedInterestRaw: earnedRaw.toString(),
      assetDecimals: resolvedDecimals,
      source: 'activity',
      currentAssets: positionAssetsDecimal,
      currentAssetsUsd: position?.assetsUsd ?? 0,
    });
  } catch (err) {
    logger.error('Failed to compute earned interest', err);
    return NextResponse.json({ error: 'Failed to compute earned interest' }, { status: 500 });
  }
}
