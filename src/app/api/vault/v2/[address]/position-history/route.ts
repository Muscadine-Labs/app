import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress, findVaultByAddress } from '@/lib/vault-utils';
import { getAssetDecimalsForSymbol, morphoAmountToDecimal, morphoAmountToRaw, normalizeMorphoShares, rawAmountToDecimal } from '@/lib/asset-decimals';
import { isValidChainId, isValidPeriod, MIN_VALID_TIMESTAMP, PERIOD_SECONDS, finalizePositionHistory, MORPHO_RATE_LIMIT_BODY, bucketSeconds, POSITION_LOOKBACK } from '@/lib/api-utils';
import { BASE_CHAIN_ID, STABLECOIN_SYMBOLS } from '@/lib/constants';
import { isMorphoRestNotFound, isMorphoRestRateLimited } from '@/lib/morpho-rest';
import { getRestVault, toBigInt, tryGetRestTokenPriceUsd } from '@/lib/morpho-rest-data';
import { fetchPosition, fetchPositionHistory } from '@/lib/morpho-rest-wallet';

/** Daily points before the hourly series starts, then the hourly series. */
function mergeHourlyTail<T extends { timestamp: number }>(daily: T[], hourly: T[]): T[] {
  if (hourly.length === 0) return daily;
  const hourlyStart = Math.min(...hourly.map((p) => p.timestamp));
  return [...daily.filter((p) => p.timestamp < hourlyStart), ...hourly];
}

/** Per-wallet data: never cache in the CDN or the Next data cache. */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || String(BASE_CHAIN_ID);
  const period = searchParams.get('period') || '30d';
  const userAddress = searchParams.get('userAddress');
  
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

    if (!userAddress || !isValidEthereumAddress(userAddress)) {
      return NextResponse.json(
        { 
          history: [],
          period,
          error: 'Invalid or missing user address'
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
    // REST samples by lookback: seven_days hourly, thirty/ninety days daily, inception daily
    // (one_year is weekly, so 1y reads inception and keeps the last year).
    const lookback = POSITION_LOOKBACK[period];

    let points: Awaited<ReturnType<typeof fetchPositionHistory>>;
    let restPosition: Awaited<ReturnType<typeof fetchPosition>>;
    let vault: Awaited<ReturnType<typeof getRestVault>> | null;
    try {
      let hourly: Awaited<ReturnType<typeof fetchPositionHistory>> = [];
      [points, hourly, restPosition, vault] = await Promise.all([
        fetchPositionHistory(chainId, address, userAddress, lookback),
        // REST's 30-day lookback is daily; the vault page and dashboard cut their 7D chart from
        // the 30d series, so its last 7 days come from the hourly `seven_days` lookback.
        period === '30d' ? fetchPositionHistory(chainId, address, userAddress, 'seven_days') : Promise.resolve([]),
        fetchPosition(chainId, address, userAddress),
        getRestVault(chainId, address).catch(() => null),
      ]);
      points = mergeHourlyTail(points, hourly);
    } catch (error) {
      if (isMorphoRestRateLimited(error)) {
        return NextResponse.json(
          { ...MORPHO_RATE_LIMIT_BODY, history: [], period },
          { status: 503 }
        );
      }
      if (isMorphoRestNotFound(error)) {
        return NextResponse.json({
          history: [],
          currentPosition: null,
          period,
          cached: false,
          timestamp: Date.now(),
        });
      }
      throw error;
    }

    const registryVault = findVaultByAddress(address);
    const assetSymbol = registryVault?.symbol ?? vault?.asset.symbol ?? 'UNKNOWN';
    const assetDecimals = vault?.asset.decimals ?? getAssetDecimalsForSymbol(assetSymbol);
    // USD uses today's price for every point: REST has no historical prices.
    const price =
      (vault ? await tryGetRestTokenPriceUsd(chainId, vault.asset.address) : null) ??
      (STABLECOIN_SYMBOLS.includes(assetSymbol.toUpperCase() as (typeof STABLECOIN_SYMBOLS)[number]) ? 1 : 0);

    const toUsd = (raw: string) => rawAmountToDecimal(toBigInt(raw), assetDecimals) * price;
    const currentPosition = {
      assets: restPosition.assets || 0,
      assetsUsd: toUsd(restPosition.assets),
      shares: restPosition.shares || 0,
    };

    const liveSharesRaw = normalizeMorphoShares(currentPosition.shares);
    const livePoint = {
      timestamp: now,
      date: new Date(now * 1000).toISOString().split('T')[0],
      assets: morphoAmountToDecimal(currentPosition.assets, assetDecimals),
      assetsUsd: currentPosition.assetsUsd,
      shares: rawAmountToDecimal(
        liveSharesRaw === '0' ? BigInt(0) : BigInt(liveSharesRaw),
        18
      ),
      assetsRaw: morphoAmountToRaw(currentPosition.assets),
    };

    const sorted = [...(points ?? [])]
      .filter((p) => Number.isFinite(p.timestamp))
      .sort((x, y) => x.timestamp - y.timestamp);
    // REST ends with an off-grid point at "now" (the live balance), not a bucket; the live tip
    // from `finalizePositionHistory` covers it.
    const buckets = sorted.length > 1 && sorted[sorted.length - 1]!.timestamp % 3600 !== 0
      ? sorted.slice(0, -1)
      : sorted;
    const rawHistory = buckets
      .map((point) => {
        const assetsRaw = toBigInt(point.assets).toString();
        return {
          timestamp: point.timestamp,
          date: new Date(point.timestamp * 1000).toISOString().split('T')[0],
          assets: rawAmountToDecimal(toBigInt(point.assets), assetDecimals),
          assetsUsd: toUsd(point.assets),
          shares: rawAmountToDecimal(toBigInt(point.shares), 18),
          assetsRaw,
        };
      })
      .filter((item) => item.timestamp >= MIN_VALID_TIMESTAMP && item.timestamp >= startTime);
    const interval = bucketSeconds(buckets);

    // Keep real empty days on an open position; only the current interval's
    // zero bucket is dropped. A closed position ends at zero (see finalizePositionHistory).
    const history = finalizePositionHistory(
      rawHistory,
      currentPosition,
      now,
      interval,
      livePoint
    );

    return NextResponse.json({
      history,
      currentPosition,
      period,
      cached: false,
      timestamp: Date.now(),
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });

  } catch (error) {
    logger.error(
      'Failed to fetch vault position history',
      error instanceof Error ? error : new Error(String(error)),
      { address: address ?? 'unknown', chainId: chainIdParam, period, userAddress }
    );

    return NextResponse.json(
      { 
        history: [],
        period,
        error: 'Failed to fetch vault position history'
      },
      { status: 500 }
    );
  }
}

