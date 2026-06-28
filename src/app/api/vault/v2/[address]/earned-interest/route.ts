import { NextRequest, NextResponse } from 'next/server';
import type { GraphQLResponse, Transaction } from '@/types/api';
import {
  getAssetDecimalsForSymbol,
  morphoAmountToDecimal,
  morphoAmountToRaw,
  normalizeMorphoShares,
} from '@/lib/asset-decimals';
import { isValidEthereumAddress, findVaultByAddress } from '@/lib/vault-utils';
import { isValidChainId, fetchMorphoGraphQL } from '@/lib/api-utils';
import { computeEarnedInterestFromActivity } from '@/lib/interest-utils';
import { fetchVaultV2ActivityData } from '@/lib/vault-v2-activity';
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

function zeroEarnedInterestResponse(
  assetDecimals: number,
  source: string,
  currentAssets = 0,
  currentAssetsUsd = 0
) {
  return NextResponse.json({
    earnedInterest: 0,
    earnedInterestUsd: 0,
    earnedInterestRaw: '0',
    assetDecimals,
    source,
    hasDeposited: false,
    currentAssets,
    currentAssetsUsd,
  });
}

function positiveEarnedFromPnl(
  pnl: number | string,
  pnlUsd: number | undefined,
  assetDecimals: number
) {
  const earnedInterestRaw = morphoAmountToRaw(pnl);
  const earnedBigInt = (() => {
    try {
      return BigInt(earnedInterestRaw);
    } catch {
      return BigInt(0);
    }
  })();
  const clampedRaw = earnedBigInt > BigInt(0) ? earnedBigInt : BigInt(0);

  return {
    earnedInterest: Number(clampedRaw) / 10 ** assetDecimals,
    earnedInterestUsd: (pnlUsd ?? 0) > 0 ? pnlUsd ?? 0 : 0,
    earnedInterestRaw: clampedRaw.toString(),
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

    const positionResponse = await fetchMorphoGraphQL(
      {
        query: positionQuery,
        variables: { userAddress, vaultAddress, chainId },
      },
      { tags: [`vault-${vaultAddress}-${chainId}`] }
    );

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

    const sharesRaw = position ? normalizeMorphoShares(position.shares) : '0';
    const hasShares = (() => {
      try {
        return BigInt(sharesRaw) > BigInt(0);
      } catch {
        return false;
      }
    })();

    let activity: {
      deposits?: Transaction[];
      withdrawals?: Transaction[];
      assetDecimals?: number;
      assetPriceUsd?: number;
    } | null = null;

    const loadActivity = async () => {
      if (activity) return activity;

      const data = await fetchVaultV2ActivityData(vaultAddress, chainId, userAddress);
      if (data.error) {
        throw new Error('Failed to fetch vault activity for earned interest');
      }
      activity = data;
      return data;
    };

    const resolveCurrentAssetsRaw = (): bigint => {
      const fromQuery = searchParams.get('currentAssetsRaw');
      if (fromQuery && /^\d+$/.test(fromQuery)) {
        try {
          return BigInt(fromQuery);
        } catch {
          // fall through
        }
      }
      if (position) {
        try {
          return BigInt(morphoAmountToRaw(position.assets));
        } catch {
          return BigInt(0);
        }
      }
      return BigInt(0);
    };

    const buildActivityEarnedResponse = (
      currentAssetsRaw: bigint,
      activityData: NonNullable<typeof activity>,
      resolvedDecimals: number
    ) => {
      const deposits = activityData.deposits ?? [];
      const withdrawals = activityData.withdrawals ?? [];
      const earnedRaw = computeEarnedInterestFromActivity({
        currentAssetsRaw,
        deposits,
        withdrawals,
      });
      const earnedDecimal = Number(earnedRaw) / 10 ** resolvedDecimals;
      const currentAssetsDecimal = Number(currentAssetsRaw) / 10 ** resolvedDecimals;
      const positionAssetsDecimal = position
        ? morphoAmountToDecimal(position.assets, resolvedDecimals)
        : 0;
      const assetPriceUsd =
        activityData.assetPriceUsd ??
        (position && positionAssetsDecimal > 0
          ? position.assetsUsd / positionAssetsDecimal
          : 0);

      return NextResponse.json({
        earnedInterest: earnedDecimal,
        earnedInterestUsd: earnedDecimal * assetPriceUsd,
        earnedInterestRaw: earnedRaw.toString(),
        assetDecimals: resolvedDecimals,
        source: 'activity',
        hasDeposited: true,
        currentAssets: currentAssetsDecimal,
        currentAssetsUsd:
          position?.assetsUsd ??
          (assetPriceUsd > 0 ? currentAssetsDecimal * assetPriceUsd : 0),
      });
    };

    const activityData = await loadActivity();
    const resolvedDecimals = activityData.assetDecimals ?? assetDecimals;
    const deposits = activityData.deposits ?? [];
    const withdrawals = activityData.withdrawals ?? [];
    const hasActivityFlow = deposits.length > 0 || withdrawals.length > 0;

    // Never deposited → earned interest is zero (ignore stray Morpho pnl).
    if (!hasShares) {
      if (!hasActivityFlow) {
        return zeroEarnedInterestResponse(assetDecimals, 'none');
      }
    }

    if (hasActivityFlow) {
      return buildActivityEarnedResponse(
        resolveCurrentAssetsRaw(),
        activityData,
        resolvedDecimals
      );
    }

    if (position?.pnl !== undefined && position.pnl !== null) {
      const earned = positiveEarnedFromPnl(position.pnl, position.pnlUsd, assetDecimals);
      return NextResponse.json({
        ...earned,
        assetDecimals,
        source: 'morpho-pnl',
        hasDeposited: true,
        currentAssets: morphoAmountToDecimal(position.assets, assetDecimals),
        currentAssetsUsd: position.assetsUsd,
      });
    }

    return zeroEarnedInterestResponse(resolvedDecimals, 'none');
  } catch (err) {
    logger.error('Failed to compute earned interest', err);
    return NextResponse.json({ error: 'Failed to compute earned interest' }, { status: 500 });
  }
}
