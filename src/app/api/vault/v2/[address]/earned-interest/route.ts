import { NextRequest, NextResponse } from 'next/server';
import type { GraphQLResponse, Transaction } from '@/types/api';
import {
  morphoAmountToDecimal,
  morphoAmountToRaw,
  normalizeMorphoShares,
  rawAmountToDecimal,
  resolveAssetDecimals,
  resolveMorphoAssetSymbol,
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
      { revalidate: 0, skipMemoryCache: true, tags: [`vault-${vaultAddress}-${chainId}`] }
    );

    const positionJson = (await positionResponse.json()) as GraphQLResponse<{
      vaultV2PositionByAddress: VaultV2PositionData | null;
    }>;

    const position = positionJson.data?.vaultV2PositionByAddress;
    const registryVault = findVaultByAddress(vaultAddress);
    const assetSymbol = resolveMorphoAssetSymbol({
      registrySymbol: registryVault?.symbol,
      assetSymbol: position?.vault?.asset?.symbol,
      assetDecimals: position?.vault?.asset?.decimals,
    });
    const assetDecimals = resolveAssetDecimals(
      assetSymbol,
      position?.vault?.asset?.decimals
    );

    const sharesRaw = position ? normalizeMorphoShares(position.shares) : '0';
    const hasShares = (() => {
      try {
        return BigInt(sharesRaw) > BigInt(0);
      } catch {
        return false;
      }
    })();

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

    const currentAssetsRaw = resolveCurrentAssetsRaw();
    const hasPosition = hasShares || currentAssetsRaw > BigInt(0);

    const buildActivityEarnedResponse = (
      assetsRaw: bigint,
      activityData: {
        deposits?: Transaction[];
        withdrawals?: Transaction[];
        assetDecimals?: number;
        assetPriceUsd?: number;
      },
      resolvedDecimals: number
    ) => {
      const deposits = activityData.deposits ?? [];
      const withdrawals = activityData.withdrawals ?? [];
      const earnedRaw = computeEarnedInterestFromActivity({
        currentAssetsRaw: assetsRaw,
        deposits,
        withdrawals,
      });
      const earnedDecimal = rawAmountToDecimal(earnedRaw, resolvedDecimals);
      const currentAssetsDecimal = rawAmountToDecimal(assetsRaw, resolvedDecimals);
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

    // Fast path: Morpho pnl when user still has a position.
    if (hasPosition && position?.pnl !== undefined && position.pnl !== null) {
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

    // Activity fallback — only when pnl is unavailable or position was closed.
    let activityData: Awaited<ReturnType<typeof fetchVaultV2ActivityData>> | null = null;
    try {
      activityData = await fetchVaultV2ActivityData(vaultAddress, chainId, userAddress);
      if (activityData.error) {
        throw new Error('Failed to fetch vault activity for earned interest');
      }
    } catch (activityError) {
      logger.warn('Failed to fetch vault activity for earned interest', {
        vaultAddress,
        chainId,
        userAddress,
        error:
          activityError instanceof Error ? activityError.message : String(activityError),
      });
    }

    const resolvedDecimals = activityData?.assetDecimals ?? assetDecimals;
    const deposits = activityData?.deposits ?? [];
    const withdrawals = activityData?.withdrawals ?? [];
    const hasActivityFlow =
      !!activityData && (deposits.length > 0 || withdrawals.length > 0);

    if (!hasPosition && !hasActivityFlow) {
      return zeroEarnedInterestResponse(assetDecimals, 'none');
    }

    if (activityData && hasActivityFlow) {
      return buildActivityEarnedResponse(
        currentAssetsRaw,
        activityData,
        resolvedDecimals
      );
    }

    if (hasPosition) {
      const currentAssetsDecimal = rawAmountToDecimal(currentAssetsRaw, resolvedDecimals);
      return NextResponse.json({
        earnedInterest: 0,
        earnedInterestUsd: 0,
        earnedInterestRaw: '0',
        assetDecimals: resolvedDecimals,
        source: 'none',
        hasDeposited: true,
        currentAssets: currentAssetsDecimal,
        currentAssetsUsd: position?.assetsUsd ?? 0,
      });
    }

    return zeroEarnedInterestResponse(resolvedDecimals, 'none');
  } catch (err) {
    logger.error('Failed to compute earned interest', err);
    return NextResponse.json({ error: 'Failed to compute earned interest' }, { status: 500 });
  }
}
