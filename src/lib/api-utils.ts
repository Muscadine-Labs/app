import { BASE_CHAIN_ID } from '@/lib/constants';

// Minimum timestamp for valid data (October 7, 2025 00:00:00 UTC)
export const MIN_VALID_TIMESTAMP = 1759795200;

// Valid periods for vault history queries
export const VALID_PERIODS = ['7d', '30d', '90d', '1y', 'all'] as const;
export type ValidPeriod = typeof VALID_PERIODS[number];

// Validation helpers
export function isValidChainId(chainId: string): boolean {
  const id = parseInt(chainId, 10);
  return Number.isInteger(id) && id === BASE_CHAIN_ID;
}

export function isValidPeriod(period: string): period is ValidPeriod {
  return VALID_PERIODS.includes(period as ValidPeriod);
}

// Period configuration
export const PERIOD_SECONDS: Record<string, number> = {
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
  '1y': 365 * 24 * 60 * 60,
};

/** Morpho REST position-history lookback per chart period (`one_year` is weekly, so 1y reads inception). */
export const POSITION_LOOKBACK = {
  '7d': 'seven_days',
  '30d': 'thirty_days',
  '90d': 'ninety_days',
  '1y': 'inception',
  all: 'inception',
} as const satisfies Record<ValidPeriod, string>;

/** Spacing of a REST timeseries (its smallest gap), hourly when it has under two points. */
export function bucketSeconds(points: ReadonlyArray<{ timestamp: number }>): number {
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const d = points[i]!.timestamp - points[i - 1]!.timestamp;
    if (d > 0 && d < gap) gap = d;
  }
  return Number.isFinite(gap) ? gap : 60 * 60;
}

/** Shared 503 payload when Morpho public API rate limit is hit. */
export const MORPHO_RATE_LIMIT_BODY = {
  error: 'Morpho API rate limit exceeded',
  details: 'Too many requests to Morpho. Wait a few minutes and retry.',
  retryable: true,
} as const;

function hasVaultTvl<
  T extends { totalAssetsUsd?: number; totalAssets?: number; sharePrice?: number },
>(point: T): boolean {
  return (
    (point.totalAssetsUsd ?? 0) > 0 ||
    (point.totalAssets ?? 0) > 0 ||
    (point.sharePrice ?? 0) > 0
  );
}

/** Morpho timeseries often includes a trailing bucket for the in-progress period with zeros. */
export function stripIncompleteVaultHistoryBuckets<
  T extends {
    totalAssetsUsd: number;
    totalAssets: number;
    sharePrice?: number;
    apy?: number;
    netApy?: number;
  },
>(history: T[]): T[] {
  let end = history.length;
  while (end > 0) {
    const point = history[end - 1];
    const zeroTvl = !hasVaultTvl(point);
    // In-progress buckets often have TVL but APY not yet computed.
    const zeroApyWithTvl =
      (point.totalAssetsUsd ?? 0) > 0 &&
      (point.apy ?? 0) === 0 &&
      (point.netApy ?? 0) === 0;
    if (!zeroTvl && !zeroApyWithTvl) break;
    end--;
  }
  if (end === history.length) return history;
  // Brand-new vaults can have only TVL/share-price points before
  // Morpho indexes avgNetApy. Keep those so Total Deposits / Share Price render.
  if (end === 0) {
    const withTvl = history.filter(hasVaultTvl);
    return withTvl.length > 0 ? withTvl : [];
  }
  return history.slice(0, end);
}

function isZeroPositionBucket(point: {
  assets: number;
  assetsUsd: number;
  shares?: number;
}): boolean {
  return (point.assets ?? 0) === 0 && (point.assetsUsd ?? 0) === 0;
}

/**
 * Drop only zero buckets inside the still-open interval.
 * Earlier zeros are a real empty position. Stripping those lets portfolio
 * forward-fill paint the previous balance across the gap.
 */
export function stripOpenIntervalPositionBuckets<
  T extends { timestamp: number; assets: number; assetsUsd: number; shares?: number },
>(history: T[], now: number, intervalSeconds: number): T[] {
  let end = history.length;
  const openAfter = now - intervalSeconds;
  while (end > 0) {
    const point = history[end - 1];
    if (point.timestamp <= openAfter || !isZeroPositionBucket(point)) break;
    end--;
  }
  return end === history.length ? history : history.slice(0, end);
}

export interface PositionHistoryItem {
  timestamp: number;
  date: string;
  assets: number;
  assetsUsd: number;
  shares: number;
  /** Underlying assets in smallest units, when the API still has them. */
  assetsRaw?: string;
}

export interface CurrentPositionLike {
  assets?: number | string | null;
  assetsUsd?: number | string | null;
  shares?: number | string | null;
}

function toFiniteNumber(value: number | string | null | undefined): number {
  const num = typeof value === 'string' ? parseFloat(value) : value ?? 0;
  return Number.isFinite(num) ? (num as number) : 0;
}

export const INTERVAL_SECONDS: Record<string, number> = {
  HOUR: 60 * 60,
  DAY: 24 * 60 * 60,
};

function toHistoryDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0];
}

function seedLivePositionSeries(
  livePoint: PositionHistoryItem,
  now: number,
  intervalSeconds: number
): PositionHistoryItem[] {
  const endTs = livePoint.timestamp > 0 ? livePoint.timestamp : now;
  const seedInterval = Math.min(intervalSeconds, INTERVAL_SECONDS.HOUR);
  const startTs = Math.max(0, endTs - seedInterval);
  const end: PositionHistoryItem = {
    ...livePoint,
    timestamp: endTs,
    date: toHistoryDate(endTs),
  };
  if (startTs === endTs) return [end];
  return [
    { ...livePoint, timestamp: startTs, date: toHistoryDate(startTs) },
    end,
  ];
}

function hasLivePositionValue(point: PositionHistoryItem): boolean {
  return point.assets > 0 || point.assetsUsd > 0 || point.shares > 0;
}

/**
 * Put the live balance at the end of an open series without replacing the
 * zeros that sit between the last indexed balance and now.
 */
function appendLivePositionTip(
  history: PositionHistoryItem[],
  livePoint: PositionHistoryItem,
  now: number
): PositionHistoryItem[] {
  const endTs = livePoint.timestamp > 0 ? livePoint.timestamp : now;
  const last = history[history.length - 1];
  if (!last || last.timestamp >= endTs) return history;
  const sameValue =
    last.assetsUsd === livePoint.assetsUsd &&
    last.assets === livePoint.assets &&
    last.shares === livePoint.shares;
  if (sameValue && endTs - last.timestamp < INTERVAL_SECONDS.DAY) return history;
  return [
    ...history,
    { ...livePoint, timestamp: endTs, date: toHistoryDate(endTs) },
  ];
}

/**
 * Finalize a position history series using the live `currentPosition`:
 *
 * - Position still OPEN (shares/assets > 0): drop zero buckets only inside the
 *   current interval. Zeros before that stay, so forward-fill does not carry an
 *   old balance across days the wallet was empty. If Morpho has not indexed any
 *   history yet, seed a short flat line from `livePoint`. If the indexed series
 *   ends at zero while the live position is open, append that live value at now.
 * - Position CLOSED (fully withdrawn): trailing zeros are real — keep them. If the
 *   series still ends at a pre-withdrawal value, append a zero point one bucket
 *   after the last point so charts and the dashboard's forward-fill aggregation
 *   drop to zero instead of being stuck at the last held amount.
 */
export function finalizePositionHistory(
  rawHistory: PositionHistoryItem[],
  currentPosition: CurrentPositionLike | null,
  now: number,
  intervalSeconds: number = INTERVAL_SECONDS.DAY,
  livePoint?: PositionHistoryItem | null
): PositionHistoryItem[] {
  const positionOpen =
    currentPosition !== null &&
    (toFiniteNumber(currentPosition.shares) > 0 ||
      toFiniteNumber(currentPosition.assets) > 0 ||
      toFiniteNumber(currentPosition.assetsUsd) > 0);

  if (positionOpen) {
    const stripped = stripOpenIntervalPositionBuckets(
      rawHistory,
      now,
      intervalSeconds
    );
    if (
      livePoint &&
      hasLivePositionValue(livePoint)
    ) {
      if (stripped.length === 0) {
        return seedLivePositionSeries(livePoint, now, intervalSeconds);
      }
      return appendLivePositionTip(stripped, livePoint, now);
    }
    return stripped;
  }

  if (rawHistory.length === 0) return rawHistory;

  const last = rawHistory[rawHistory.length - 1];
  const lastIsZero = last.assets === 0 && last.assetsUsd === 0 && last.shares === 0;
  if (lastIsZero) return rawHistory;

  const zeroTimestamp = Math.min(last.timestamp + intervalSeconds, now);
  return [
    ...rawHistory,
    {
      timestamp: zeroTimestamp,
      date: toHistoryDate(zeroTimestamp),
      assets: 0,
      assetsUsd: 0,
      shares: 0,
      assetsRaw: '0',
    },
  ];
}

