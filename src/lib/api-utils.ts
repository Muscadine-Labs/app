// Minimum timestamp for valid data (October 7, 2025 00:00:00 UTC)
export const MIN_VALID_TIMESTAMP = 1759795200;

// Valid periods for vault history queries
export const VALID_PERIODS = ['7d', '30d', '90d', '1y', 'all'] as const;
export type ValidPeriod = typeof VALID_PERIODS[number];

// Validation helpers
export function isValidChainId(chainId: string): boolean {
  const id = parseInt(chainId, 10);
  return !isNaN(id) && id > 0 && id <= 2147483647;
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

export const INTERVAL_MAP: Record<string, string> = {
  '7d': 'HOUR',
  '30d': 'HOUR',
  '90d': 'DAY',
  '1y': 'DAY',
  'all': 'DAY',
};

/** Morpho timeseries often includes a trailing bucket for the in-progress period with zeros. */
export function stripIncompleteVaultHistoryBuckets<
  T extends { totalAssetsUsd: number; totalAssets: number; sharePrice?: number },
>(history: T[]): T[] {
  let end = history.length;
  while (end > 0) {
    const point = history[end - 1];
    const isIncomplete =
      (point.totalAssetsUsd ?? 0) === 0 &&
      (point.totalAssets ?? 0) === 0 &&
      (point.sharePrice ?? 0) === 0;
    if (!isIncomplete) break;
    end--;
  }
  return end === history.length ? history : history.slice(0, end);
}

export function stripIncompletePositionHistoryBuckets<
  T extends { assets: number; assetsUsd: number; shares?: number },
>(history: T[]): T[] {
  let end = history.length;
  while (end > 0) {
    const point = history[end - 1];
    const isIncomplete =
      (point.assets ?? 0) === 0 &&
      (point.assetsUsd ?? 0) === 0 &&
      (point.shares ?? 0) === 0;
    if (!isIncomplete) break;
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

/**
 * Finalize a position history series using the live `currentPosition`:
 *
 * - Position still OPEN (shares/assets > 0): trailing zero buckets are Morpho's
 *   incomplete in-progress interval — strip them (avoids charts dipping to zero).
 * - Position CLOSED (fully withdrawn): trailing zeros are REAL — keep them. If the
 *   series still ends at a pre-withdrawal value (a known Morpho v1 quirk), append a
 *   zero point one bucket after the last point so charts and the dashboard's
 *   forward-fill aggregation drop to zero instead of being stuck at the last
 *   held amount.
 */
export function finalizePositionHistory(
  rawHistory: PositionHistoryItem[],
  currentPosition: CurrentPositionLike | null,
  now: number,
  intervalSeconds: number = INTERVAL_SECONDS.DAY
): PositionHistoryItem[] {
  const positionOpen =
    currentPosition !== null &&
    (toFiniteNumber(currentPosition.shares) > 0 ||
      toFiniteNumber(currentPosition.assets) > 0 ||
      toFiniteNumber(currentPosition.assetsUsd) > 0);

  if (positionOpen) {
    return stripIncompletePositionHistoryBuckets(rawHistory);
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
      date: new Date(zeroTimestamp * 1000).toISOString().split('T')[0],
      assets: 0,
      assetsUsd: 0,
      shares: 0,
    },
  ];
}

