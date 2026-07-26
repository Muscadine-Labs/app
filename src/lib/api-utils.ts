import { logger } from '@/lib/logger';
import {
  MORPHO_FETCH_TIMEOUT_MS,
  MORPHO_GRAPHQL_REVALIDATE_SECONDS,
  MORPHO_GRAPHQL_URL,
  MORPHO_MAX_RETRIES,
  MORPHO_MEMORY_CACHE_MS,
} from '@/lib/constants';

let morphoGraphqlCallCount = 0;

function logMorphoGraphqlCall(body: { query: string; variables?: Record<string, unknown> }) {
  if (process.env.NODE_ENV !== 'development') return;
  morphoGraphqlCallCount += 1;
  if (morphoGraphqlCallCount === 1 || morphoGraphqlCallCount % 25 === 0) {
    const opMatch = body.query.match(/(?:query|mutation)\s+(\w+)/);
    logger.debug('Morpho GraphQL upstream call', {
      count: morphoGraphqlCallCount,
      operation: opMatch?.[1] ?? 'anonymous',
    });
  }
}

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

type MorphoCacheEntry = {
  expiresAt: number;
  responseText: string;
  status: number;
  ok: boolean;
};

const morphoResponseCache = new Map<string, MorphoCacheEntry>();

function morphoMemoryCacheTtlMs(): number {
  return MORPHO_MEMORY_CACHE_MS;
}

function morphoCacheKey(body: { query: string; variables?: Record<string, unknown> }): string {
  return JSON.stringify(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMorphoResponse(entry: MorphoCacheEntry): Response {
  return new Response(entry.responseText, {
    status: entry.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type MorphoAssetPriceFields = {
  price?: { usd?: number | null } | null;
};

/** Read USD price from Morpho Asset (`price.usd`). */
export function resolveMorphoAssetPriceUsd(
  asset: MorphoAssetPriceFields | null | undefined,
  fallback = 0
): number {
  const usd = asset?.price?.usd;
  if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
    return usd;
  }
  return fallback;
}

export function isMorphoRateLimitError(status: number, responseText: string): boolean {
  if (status === 429) return true;
  try {
    const parsed = JSON.parse(responseText) as { error?: string };
    return parsed.error === 'public_blue_api_rate_limit_exceeded';
  } catch {
    return false;
  }
}

/** Shared 503 payload when Morpho public API rate limit is hit. */
export const MORPHO_RATE_LIMIT_BODY = {
  error: 'Morpho API rate limit exceeded',
  details: 'Too many requests to Morpho. Wait a few minutes and retry.',
  retryable: true,
} as const;

export async function readMorphoGraphQLResponse(response: Response): Promise<{
  responseText: string;
  rateLimited: boolean;
}> {
  const responseText = await response.text();
  return {
    responseText,
    rateLimited: isMorphoRateLimitError(response.status, responseText),
  };
}

/** POST to Morpho GraphQL with cache TTL, in-memory dev cache, retries, and abort timeout. */
export async function fetchMorphoGraphQL(
  body: { query: string; variables?: Record<string, unknown> },
  options?: {
    revalidate?: number;
    timeoutMs?: number;
    tags?: string[];
    /** Bypass the 60s in-memory cache (required for user-specific reads). */
    skipMemoryCache?: boolean;
  }
): Promise<Response> {
  const cacheKey = morphoCacheKey(body);
  const now = Date.now();
  const skipMemoryCache =
    options?.skipMemoryCache === true || options?.revalidate === 0;
  const cached = skipMemoryCache ? undefined : morphoResponseCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return toMorphoResponse(cached);
  }

  let lastEntry: MorphoCacheEntry | null = null;

  for (let attempt = 1; attempt <= MORPHO_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? MORPHO_FETCH_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response | undefined;
    let responseText: string;

    try {
      logMorphoGraphqlCall(body);
      response = await fetch(MORPHO_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        next: {
          revalidate: options?.revalidate ?? MORPHO_GRAPHQL_REVALIDATE_SECONDS,
          ...(options?.tags ? { tags: options.tags } : {}),
        },
      });
      responseText = await response.text();
    } catch {
      if (attempt < MORPHO_MAX_RETRIES) {
        await sleep(1500 * attempt);
        continue;
      }
      break;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response) break;

    const entry: MorphoCacheEntry = {
      expiresAt: now + morphoMemoryCacheTtlMs(),
      responseText,
      status: response.status,
      ok: response.ok,
    };
    lastEntry = entry;

    if (response.ok) {
      if (!skipMemoryCache) {
        morphoResponseCache.set(cacheKey, entry);
      }
      return toMorphoResponse(entry);
    }

    if (isMorphoRateLimitError(response.status, responseText)) {
      if (!skipMemoryCache && cached?.ok) {
        return toMorphoResponse(cached);
      }
      if (attempt < MORPHO_MAX_RETRIES) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : 1500 * attempt;
        await sleep(Number.isFinite(retryMs) ? retryMs : 1500 * attempt);
        continue;
      }
    }

    break;
  }

  if (!skipMemoryCache && cached?.ok && lastEntry && isMorphoRateLimitError(lastEntry.status, lastEntry.responseText)) {
    return toMorphoResponse(cached);
  }

  if (lastEntry) {
    return toMorphoResponse(lastEntry);
  }

  return new Response(JSON.stringify({ error: 'Morpho API request failed' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
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
    const zeroTvl =
      (point.totalAssetsUsd ?? 0) === 0 &&
      (point.totalAssets ?? 0) === 0 &&
      (point.sharePrice ?? 0) === 0;
    // In-progress buckets often have TVL but APY not yet computed.
    const zeroApyWithTvl =
      (point.totalAssetsUsd ?? 0) > 0 &&
      (point.apy ?? 0) === 0 &&
      (point.netApy ?? 0) === 0;
    if (!zeroTvl && !zeroApyWithTvl) break;
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
    // Trailing buckets may still report shares while assets/assetsUsd are zero.
    const isIncomplete =
      (point.assets ?? 0) === 0 && (point.assetsUsd ?? 0) === 0;
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

