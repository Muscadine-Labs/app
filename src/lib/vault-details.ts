import type { VaultTimelock } from '@/types/vault';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';

const SECONDS_PER_YEAR = BigInt(31_536_000);
const WAD = BigInt(10) ** BigInt(18);

/** `604800` → `7 days`, `259200` → `3 days`, `0` → `No delay`. */
export function formatTimelockDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'No delay';
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  if (seconds % 86_400 === 0) return plural(seconds / 86_400, 'day');
  if (seconds % 3_600 === 0) return plural(seconds / 3_600, 'hour');
  if (seconds >= 86_400) return plural(Math.round((seconds / 86_400) * 10) / 10, 'day');
  if (seconds >= 3_600) return plural(Math.round((seconds / 3_600) * 10) / 10, 'hour');
  return plural(Math.max(1, Math.round(seconds / 60)), 'minute');
}

export interface TimelockGroup {
  label: string;
  functions: string[];
}

/** Longest delay first, then functions with no delay, then abdicated functions. */
export function groupTimelocks(timelocks: readonly VaultTimelock[]): TimelockGroup[] {
  const byDuration = new Map<number, string[]>();
  const abdicated: string[] = [];
  for (const timelock of timelocks) {
    if (timelock.abdicated) {
      abdicated.push(timelock.functionName);
      continue;
    }
    const list = byDuration.get(timelock.duration) ?? [];
    list.push(timelock.functionName);
    byDuration.set(timelock.duration, list);
  }
  const groups: TimelockGroup[] = [...byDuration.entries()]
    .sort(([a], [b]) => b - a)
    .map(([duration, functions]) => ({ label: formatTimelockDuration(duration), functions }));
  if (abdicated.length > 0) {
    groups.push({ label: 'Abdicated', functions: abdicated });
  }
  return groups;
}

/**
 * Vault V2 `maxRate` (per second, WAD) as a yearly percentage, e.g. 200 for 200%.
 * Null when the value is missing or unreadable.
 */
export function maxRateToAnnualPercent(maxRate: string | null | undefined): number | null {
  if (maxRate == null || maxRate === '') return null;
  try {
    // Rounded to the nearest basis point: the stored rate is 200%/yr divided by seconds, floored.
    const perYearBps = (BigInt(maxRate) * SECONDS_PER_YEAR * BigInt(10_000) + WAD / BigInt(2)) / WAD;
    return Number(perYearBps) / 100;
  } catch {
    return null;
  }
}

/** One cent. Smaller positions stay out of the default allocation view. */
export const ALLOCATION_DUST_USD = 0.01;

/** True when a position is missing, zero, or at most {@link ALLOCATION_DUST_USD}. */
export function isAllocationDust(usd: number): boolean {
  return !Number.isFinite(usd) || usd <= ALLOCATION_DUST_USD;
}

export interface ExposureItem {
  symbol: string;
  usd: number;
  /** Fraction of the vault's allocated USD, 0–1. */
  share: number;
}

export interface ExposureSummary {
  items: ExposureItem[];
  marketCount: number;
  idleUsd: number;
  totalUsd: number;
}

/**
 * Collateral the vault lends against, largest first, grouped by collateral token.
 * Rows with no USD value are skipped (caps on markets the vault is not in).
 */
export function summarizeExposure(allocations: readonly VaultMarketAllocation[]): ExposureSummary {
  const bySymbol = new Map<string, number>();
  let idleUsd = 0;
  let marketCount = 0;
  for (const row of allocations) {
    const usd = Number.isFinite(row.allocatedUsd) ? row.allocatedUsd : 0;
    if (row.kind === 'idle') {
      idleUsd += usd;
      continue;
    }
    if (row.kind !== 'market' || usd <= 0) continue;
    marketCount += 1;
    const symbol = row.collateralSymbol || row.name;
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + usd);
  }
  const marketUsd = [...bySymbol.values()].reduce((sum, usd) => sum + usd, 0);
  const totalUsd = marketUsd + idleUsd;
  const items = [...bySymbol.entries()]
    .map(([symbol, usd]) => ({ symbol, usd, share: totalUsd > 0 ? usd / totalUsd : 0 }))
    .sort((a, b) => b.usd - a.usd);
  return { items, marketCount, idleUsd, totalUsd };
}

/** `0.676` → `68%`; under 1% → `<1%`. */
export function formatSharePercent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}

/** Allocation share, always two decimal places. `0.43` → `43.00%`. */
export function formatAllocationSharePercent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0.00%';
  const percent = Math.round(share * 10000) / 100;
  if (percent < 0.01) return '<0.01%';
  return `${percent.toFixed(2)}%`;
}

/** When a pending change can take effect: `Takes effect in 3 days`, or `Can take effect now`. */
export function formatTimeUntil(validAt: number, nowSeconds: number): string {
  if (!validAt) return 'Waiting on its timelock';
  const remaining = validAt - nowSeconds;
  if (remaining <= 0) return 'Can take effect now';
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  // Nearest unit: a 7-day timelock queued a minute ago still reads 7 days.
  if (remaining >= 86_400) return `Takes effect in ${plural(Math.round(remaining / 86_400), 'day')}`;
  if (remaining >= 3_600) return `Takes effect in ${plural(Math.round(remaining / 3_600), 'hour')}`;
  return `Takes effect in ${plural(Math.max(1, Math.ceil(remaining / 60)), 'minute')}`;
}
