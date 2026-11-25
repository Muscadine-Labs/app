import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId, isValidPeriod, MIN_VALID_TIMESTAMP, PERIOD_SECONDS, POSITION_LOOKBACK, stripIncompleteVaultHistoryBuckets, MORPHO_RATE_LIMIT_BODY } from '@/lib/api-utils';
import { BASE_CHAIN_ID, MORPHO_REST_REVALIDATE_SECONDS } from '@/lib/constants';
import { isMorphoRestNotFound, isMorphoRestRateLimited, morphoRestGet, morphoSelector } from '@/lib/morpho-rest';
import { getRestVault, rawToNumber, toBigInt, tryGetRestTokenPriceUsd } from '@/lib/morpho-rest-data';

type RestStatePoint = {
  timestamp: number;
  total_assets: string;
  total_supply: string;
  share_price_ray?: string | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || String(BASE_CHAIN_ID);
  const period = searchParams.get('period') || '30d';
  
  let address: string | undefined;
  try {
    const resolvedParams = await params;
    address = resolvedParams.address;

    // Validate inputs
    if (!isValidEthereumAddress(address)) {
      return NextResponse.json(
        { 
          history: [],
          period,
          error: 'Invalid vault address format'
        },
        { status: 400 }
      );
    }

    if (!isValidChainId(chainIdParam)) {
      return NextResponse.json(
        { 
          history: [],
          period,
          error: 'Invalid chain ID'
        },
        { status: 400 }
      );
    }

    if (!isValidPeriod(period)) {
      return NextResponse.json(
        { 
          history: [],
          period,
          error: 'Invalid period. Must be one of: 7d, 30d, 90d, 1y, all'
        },
        { status: 400 }
      );
    }

    const chainId = parseInt(chainIdParam, 10);
    const now = Math.floor(Date.now() / 1000);
    const startTime = period === 'all' ? 0 : (now - (PERIOD_SECONDS[period] || PERIOD_SECONDS['30d']));
    const lookback = POSITION_LOOKBACK[period];
    const selector = morphoSelector(chainId, address);

    let statePoints: RestStatePoint[];
    let apyPoints: Array<{ timestamp: number; apy: number | null }>;
    let vault: Awaited<ReturnType<typeof getRestVault>>;
    try {
      [statePoints, apyPoints, vault] = await Promise.all([
        morphoRestGet<RestStatePoint[]>(`/v0/vaults-v2/${selector}/state/history`, { lookback }),
        // Morpho's APY points are trailing averages (seven_days → 1-day, thirty_days → 7-day,
        // ninety_days / inception → 30-day), not per-bucket APY.
        morphoRestGet<Array<{ timestamp: number; apy: number | null }>>(
          `/v0/vaults-v2/${selector}/apy/history`,
          { lookback }
        ).catch(() => []),
        getRestVault(chainId, address),
      ]);
    } catch (error) {
      if (isMorphoRestRateLimited(error)) {
        return NextResponse.json({ ...MORPHO_RATE_LIMIT_BODY, history: [], period }, { status: 503 });
      }
      if (isMorphoRestNotFound(error)) {
        return NextResponse.json({ history: [], period, cached: false, timestamp: Date.now() });
      }
      throw error;
    }

    const assetDecimals = vault.asset.decimals ?? 18;
    // USD uses today's price for every point: REST has no historical prices.
    const assetPriceUsd = (await tryGetRestTokenPriceUsd(chainId, vault.asset.address)) ?? 0;
    const apyMap = new Map<number, number>();
    for (const point of apyPoints ?? []) {
      if (typeof point.apy === 'number' && Number.isFinite(point.apy)) apyMap.set(point.timestamp, point.apy);
    }

    const rawHistory = [...(statePoints ?? [])]
      .filter((point) => Number.isFinite(point.timestamp))
      .sort((x, y) => x.timestamp - y.timestamp)
      .map((point) => {
        const totalAssets = rawToNumber(point.total_assets, assetDecimals);
        const sharePrice = point.share_price_ray ? Number(toBigInt(point.share_price_ray) / BigInt(1e9)) / 1e18 : 0;
        const apy = apyMap.get(point.timestamp);
        return {
          timestamp: point.timestamp,
          date: new Date(point.timestamp * 1000).toISOString().split('T')[0],
          totalAssetsUsd: totalAssets * assetPriceUsd,
          totalAssets,
          sharePrice,
          sharePriceUsd: sharePrice * assetPriceUsd,
          assetPriceUsd,
          apy: (apy ?? 0) * 100,
          netApy: (apy ?? 0) * 100,
          // A bucket with no APY is plotted as a gap, not a real 0%.
          hasApy: apy !== undefined,
        };
      })
      .filter((item) => item.timestamp >= MIN_VALID_TIMESTAMP && item.timestamp >= startTime);

    const history = stripIncompleteVaultHistoryBuckets(rawHistory);

    return NextResponse.json({
      history,
      period,
      cached: false,
      timestamp: Date.now(),
    }, {
      headers: {
        'Cache-Control': `public, s-maxage=${MORPHO_REST_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_REST_REVALIDATE_SECONDS * 2}`,
      }
    });

  } catch (error) {
    logger.error(
      'Failed to fetch vault history',
      error instanceof Error ? error : new Error(String(error)),
      { address: address ?? 'unknown', chainId: chainIdParam, period }
    );

    return NextResponse.json(
      { 
        history: [],
        period,
        error: 'Failed to fetch vault history'
      },
      { status: 500 }
    );
  }
}
