import { morphoRestGet, morphoSelector } from '@/lib/morpho-rest';
import { logger } from '@/lib/logger';

/** Vault totals over time (raw units), to value share transfers at the time they happened. */

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export type VaultRatioPoint = { timestamp: number; totalAssets: bigint; totalSupply: bigint };

export type SharePriceLookup = VaultRatioPoint[];

function assetsAtPoint(shares: bigint, point: VaultRatioPoint): bigint {
  return point.totalSupply > BigInt(0) ? (shares * point.totalAssets) / point.totalSupply : BigInt(0);
}

/**
 * Raw assets `shares` were worth at `timestamp`: linear between the indexed points around it
 * (hourly within the last 7 days, daily before), the nearest point at either end.
 * `undefined` with no points or no shares.
 */
export function sharesToAssetsAt(
  lookup: SharePriceLookup,
  shares: string | undefined | null,
  timestamp: number
): string | undefined {
  if (!shares || lookup.length === 0 || !Number.isFinite(timestamp)) return undefined;
  let amount: bigint;
  try {
    amount = BigInt(shares);
  } catch {
    return undefined;
  }
  if (amount <= BigInt(0)) return undefined;
  const first = lookup[0]!;
  const last = lookup[lookup.length - 1]!;
  if (timestamp <= first.timestamp) return assetsAtPoint(amount, first).toString();
  if (timestamp >= last.timestamp) return assetsAtPoint(amount, last).toString();
  let lo = 0;
  let hi = lookup.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lookup[mid]!.timestamp <= timestamp) lo = mid;
    else hi = mid;
  }
  const a = lookup[lo]!;
  const b = lookup[hi]!;
  const va = assetsAtPoint(amount, a);
  const vb = assetsAtPoint(amount, b);
  const span = BigInt(b.timestamp - a.timestamp);
  if (span <= BigInt(0)) return va.toString();
  return (va + ((vb - va) * BigInt(timestamp - a.timestamp)) / span).toString();
}

/** Raw assets for `shares` at a vault's current totals. */
export function sharesToAssetsRaw(
  shares: string | undefined | null,
  totals: { totalAssets: bigint; totalSupply: bigint }
): string | undefined {
  if (!shares || totals.totalSupply <= BigInt(0)) return undefined;
  try {
    const amount = BigInt(shares);
    if (amount <= BigInt(0)) return undefined;
    return ((amount * totals.totalAssets) / totals.totalSupply).toString();
  } catch {
    return undefined;
  }
}

/**
 * Indexed vault totals from Morpho REST `state/history`, covering `earliestTimestamp`:
 * hourly (`seven_days`) when it is recent, else daily from inception. `null` on failure.
 */
export async function fetchSharePriceLookup(options: {
  vaultAddress: string;
  chainId: number;
  earliestTimestamp: number;
}): Promise<SharePriceLookup | null> {
  const { vaultAddress, chainId, earliestTimestamp } = options;
  const now = Math.floor(Date.now() / 1000);
  const lookback = now - earliestTimestamp < SEVEN_DAYS_SECONDS - 3600 ? 'seven_days' : 'inception';
  try {
    const points = await morphoRestGet<Array<{ timestamp: number; total_assets?: string | null; total_supply?: string | null }>>(
      `/v0/vaults-v2/${morphoSelector(chainId, vaultAddress)}/state/history`,
      { lookback }
    );
    const lookup: SharePriceLookup = [];
    for (const point of points ?? []) {
      if (!Number.isFinite(point.timestamp) || !point.total_assets || !point.total_supply) continue;
      try {
        const totalAssets = BigInt(point.total_assets);
        const totalSupply = BigInt(point.total_supply);
        if (totalSupply > BigInt(0)) lookup.push({ timestamp: point.timestamp, totalAssets, totalSupply });
      } catch {
        /* skip a malformed point */
      }
    }
    lookup.sort((a, b) => a.timestamp - b.timestamp);
    return lookup.length > 0 ? lookup : null;
  } catch (error) {
    logger.warn('Failed to fetch historical share prices', {
      vaultAddress,
      chainId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
