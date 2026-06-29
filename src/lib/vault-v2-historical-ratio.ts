import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { fetchMorphoGraphQL } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

type TimeseriesPoint = { x?: number | null; y?: number | string | null };

export type VaultRatioSnapshot = {
  totalAssets: bigint;
  totalSupply: bigint;
};

type HistoricalRatioLookup = {
  assetsSeries: Array<{ timestamp: number; value: bigint }>;
  supplySeries: Array<{ timestamp: number; value: bigint }>;
};

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

function parseTimeseriesBigInt(value: number | string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return BigInt(Math.floor(value));
    }
    const trimmed = value.includes('.') ? value.split('.')[0] : value;
    if (!trimmed) return null;
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

function buildSortedSeries(
  points: TimeseriesPoint[] | null | undefined
): Array<{ timestamp: number; value: bigint }> {
  if (!points?.length) return [];

  const series: Array<{ timestamp: number; value: bigint }> = [];
  for (const point of points) {
    if (point.x == null) continue;
    const value = parseTimeseriesBigInt(point.y);
    if (value === null || value < BigInt(0)) continue;
    series.push({ timestamp: point.x, value });
  }

  series.sort((a, b) => a.timestamp - b.timestamp);

  const deduped: typeof series = [];
  for (const entry of series) {
    const last = deduped[deduped.length - 1];
    if (last && last.timestamp === entry.timestamp) {
      deduped[deduped.length - 1] = entry;
    } else {
      deduped.push(entry);
    }
  }

  return deduped;
}

/** Last sample at or before `timestamp` (Morpho historical buckets). */
export function lookupTimeseriesAt(
  series: ReadonlyArray<{ timestamp: number; value: bigint }>,
  timestamp: number
): bigint | null {
  if (!series.length || !Number.isFinite(timestamp)) return null;

  let lo = 0;
  let hi = series.length - 1;
  let result: bigint | null = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = series[mid]!;
    if (point.timestamp <= timestamp) {
      result = point.value;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

export function lookupVaultRatioAt(
  lookup: HistoricalRatioLookup,
  timestamp: number
): VaultRatioSnapshot | null {
  const totalAssets = lookupTimeseriesAt(lookup.assetsSeries, timestamp);
  const totalSupply = lookupTimeseriesAt(lookup.supplySeries, timestamp);
  if (
    totalAssets === null ||
    totalSupply === null ||
    totalSupply === BigInt(0)
  ) {
    return null;
  }
  return { totalAssets, totalSupply };
}

export function sharesToAssetsRaw(
  shares: string | undefined,
  ratio: VaultRatioSnapshot
): string | undefined {
  if (!shares) return undefined;
  if (ratio.totalSupply === BigInt(0)) return undefined;
  try {
    const shareAmount = BigInt(shares);
    if (shareAmount <= BigInt(0)) return undefined;
    return String((shareAmount * ratio.totalAssets) / ratio.totalSupply);
  } catch {
    return undefined;
  }
}

function pickHistoricalInterval(startTimestamp: number, endTimestamp: number): 'HOUR' | 'DAY' {
  const span = Math.max(0, endTimestamp - startTimestamp);
  return span <= THIRTY_DAYS_SECONDS ? 'HOUR' : 'DAY';
}

/**
 * Fetch Morpho historical totalAssets / totalSupply for transfer share conversion.
 * Falls back to caller-provided spot ratio when a timestamp has no bucket.
 */
export async function fetchHistoricalVaultRatios(options: {
  vaultAddress: string;
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalRatioLookup | null> {
  const { vaultAddress, chainId, startTimestamp, endTimestamp } = options;
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
    return null;
  }

  const query = `
    query VaultV2HistoricalRatio($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
      vaultV2ByAddress(address: $address, chainId: $chainId) {
        historicalState {
          totalAssets(options: $options) {
            x
            y
          }
          totalSupply(options: $options) {
            x
            y
          }
        }
      }
    }
  `;

  try {
    const response = await fetchMorphoGraphQL(
      {
        query,
        variables: {
          address: vaultAddress,
          chainId,
          options: {
            startTimestamp,
            endTimestamp: endTimestamp + 3600,
            interval: pickHistoricalInterval(startTimestamp, endTimestamp),
          },
        },
      },
      {
        revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS,
        tags: [`vault-${vaultAddress}-${chainId}-history`],
      }
    );

    if (!response.ok) {
      logger.warn('Historical vault ratio fetch failed', {
        vaultAddress,
        chainId,
        status: response.status,
      });
      return null;
    }

    const json = (await response.json()) as {
      data?: {
        vaultV2ByAddress?: {
          historicalState?: {
            totalAssets?: TimeseriesPoint[] | null;
            totalSupply?: TimeseriesPoint[] | null;
          } | null;
        } | null;
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      logger.warn('GraphQL errors in historical vault ratio query', {
        vaultAddress,
        chainId,
        errors: json.errors.map((e) => e.message),
      });
      return null;
    }

    const historical = json.data?.vaultV2ByAddress?.historicalState;
    const assetsSeries = buildSortedSeries(historical?.totalAssets);
    const supplySeries = buildSortedSeries(historical?.totalSupply);

    if (!assetsSeries.length || !supplySeries.length) {
      return null;
    }

    return { assetsSeries, supplySeries };
  } catch (error) {
    logger.warn('Failed to fetch historical vault ratios', {
      vaultAddress,
      chainId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
