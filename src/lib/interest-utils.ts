import type { Transaction } from '@/types/api';
import { morphoAmountToRaw, rawAmountToDecimal } from '@/lib/asset-decimals';
import { chartTokenAmountToRaw } from '@/lib/formatter';

export type ActivityFlowEvent = {
  timestamp: number;
  deltaRaw: bigint;
};

function transactionToRaw(value: Transaction['assets']): bigint {
  const raw = morphoAmountToRaw(value as string | number | null | undefined);
  return raw === '0' ? BigInt(0) : BigInt(raw);
}

/**
 * Earned interest = current position − net deposits.
 * Equivalent to: total withdrawn + current position − total deposited.
 * Uses raw asset amounts in the vault's underlying token decimals.
 */
export function computeEarnedInterestFromActivity(options: {
  currentAssetsRaw: bigint;
  deposits: Transaction[];
  withdrawals: Transaction[];
}): bigint {
  const { currentAssetsRaw, deposits, withdrawals } = options;

  let totalDeposits = BigInt(0);
  for (const tx of deposits) {
    totalDeposits += transactionToRaw(tx.assets);
  }

  let totalWithdrawals = BigInt(0);
  for (const tx of withdrawals) {
    totalWithdrawals += transactionToRaw(tx.assets);
  }

  const netDeposits =
    totalDeposits > totalWithdrawals ? totalDeposits - totalWithdrawals : BigInt(0);
  const earned = currentAssetsRaw - netDeposits;
  return earned > BigInt(0) ? earned : BigInt(0);
}

/** Chronological net deposit/withdraw deltas from activity (includes transfer in/out). */
export function buildActivityFlowEvents(
  deposits: Transaction[],
  withdrawals: Transaction[]
): ActivityFlowEvent[] {
  const events: ActivityFlowEvent[] = [];

  for (const tx of deposits) {
    const deltaRaw = transactionToRaw(tx.assets);
    if (deltaRaw <= BigInt(0)) continue;
    events.push({
      timestamp: tx.timestamp ?? 0,
      deltaRaw,
    });
  }

  for (const tx of withdrawals) {
    const deltaRaw = transactionToRaw(tx.assets);
    if (deltaRaw <= BigInt(0)) continue;
    events.push({
      timestamp: tx.timestamp ?? 0,
      deltaRaw: -deltaRaw,
    });
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

/** Cumulative net deposits (principal) at or before `timestamp`. */
export function netDepositRawAtTime(
  events: ReadonlyArray<ActivityFlowEvent>,
  timestamp: number
): bigint {
  let net = BigInt(0);
  for (const event of events) {
    if (event.timestamp <= timestamp) {
      net += event.deltaRaw;
    }
  }
  return net > BigInt(0) ? net : BigInt(0);
}

/** Split position value into principal (deposited) and earned interest. */
export function splitPositionValueAtPoint(options: {
  positionValueRaw: bigint;
  netDepositRaw: bigint;
}): { depositedRaw: bigint; interestRaw: bigint } {
  const { positionValueRaw, netDepositRaw } = options;
  const depositedRaw =
    netDepositRaw > positionValueRaw ? positionValueRaw : netDepositRaw;
  const interestRaw =
    positionValueRaw > depositedRaw ? positionValueRaw - depositedRaw : BigInt(0);
  return { depositedRaw, interestRaw };
}

export const EARNINGS_PERIOD_SECONDS = {
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
  year: 365 * 24 * 60 * 60,
} as const;

export type EarningsPeriodId = keyof typeof EARNINGS_PERIOD_SECONDS;

export type PositionHistoryPoint = {
  timestamp: number;
  assets: number;
  assetsRaw?: string;
};

export function firstPositivePositionTimestamp(
  history: ReadonlyArray<PositionHistoryPoint>
): number | null {
  let first: number | null = null;
  for (const point of history) {
    const hasAssets =
      point.assets > 0 ||
      (point.assetsRaw !== undefined && point.assetsRaw !== '0');
    if (hasAssets && (first === null || point.timestamp < first)) {
      first = point.timestamp;
    }
  }
  return first;
}

export function assetsRawAtOrBefore(
  history: ReadonlyArray<PositionHistoryPoint>,
  timestamp: number,
  decimals: number
): bigint {
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  let lastAssets = 0;
  let lastRaw: bigint | null = null;
  for (const point of sorted) {
    if (point.timestamp <= timestamp) {
      lastAssets = point.assets;
      if (point.assetsRaw !== undefined) {
        try {
          lastRaw = BigInt(point.assetsRaw);
        } catch {
          lastRaw = null;
        }
      } else {
        lastRaw = null;
      }
    } else {
      break;
    }
  }
  if (lastRaw !== null) return lastRaw;
  return chartTokenAmountToRaw(lastAssets, decimals);
}

/**
 * Interest accrued during a window. Hidden only when this wallet has never
 * had a position. If the first deposit is inside the window, earned is from
 * that deposit through now (so Past year still shows for newer positions).
 */
export function periodInterestRaw(options: {
  nowTs: number;
  periodSeconds: number;
  firstPositionTs: number | null;
  startPositionRaw: bigint;
  currentPositionRaw: bigint;
  events: ReadonlyArray<ActivityFlowEvent>;
}): { hidden: boolean; earnedRaw: bigint } {
  if (options.firstPositionTs === null) {
    return { hidden: true, earnedRaw: BigInt(0) };
  }

  const { interestRaw: nowInterest } = splitPositionValueAtPoint({
    positionValueRaw: options.currentPositionRaw,
    netDepositRaw: netDepositRawAtTime(options.events, options.nowTs),
  });
  const startTs = options.nowTs - options.periodSeconds;
  const { interestRaw: startInterest } = splitPositionValueAtPoint({
    positionValueRaw: options.startPositionRaw,
    netDepositRaw: netDepositRawAtTime(options.events, startTs),
  });
  const earned =
    nowInterest > startInterest ? nowInterest - startInterest : BigInt(0);
  return { hidden: false, earnedRaw: earned };
}

export type EarningsDisplayRow = {
  label: string;
  raw: bigint;
  usd: number;
};

const PAST_PERIODS: Array<{ id: EarningsPeriodId; label: string }> = [
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'year', label: 'Past year' },
];

const PROJECTED_PERIODS: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Projected weekly earnings' },
  { days: 30, label: 'Projected monthly earnings' },
  { days: 365, label: 'Projected yearly earnings' },
];

export function buildPastEarningsRows(options: {
  nowTs: number;
  decimals: number;
  assetPriceUsd: number;
  currentAssetsRaw: bigint;
  history: ReadonlyArray<PositionHistoryPoint>;
  events: ReadonlyArray<ActivityFlowEvent> | null;
}): EarningsDisplayRow[] {
  const { nowTs, decimals, assetPriceUsd, currentAssetsRaw, history, events } = options;
  if (nowTs <= 0 || !events || events.length === 0) return [];
  const firstFromHistory = firstPositivePositionTimestamp(history);
  const firstFromEvents = events[0]?.timestamp ?? null;
  const firstPositionTs =
    firstFromHistory ?? (firstFromEvents && firstFromEvents > 0 ? firstFromEvents : null);

  return PAST_PERIODS.flatMap((row) => {
    const periodSeconds = EARNINGS_PERIOD_SECONDS[row.id];
    const startTs = nowTs - periodSeconds;
    const result = periodInterestRaw({
      nowTs,
      periodSeconds,
      firstPositionTs,
      startPositionRaw: assetsRawAtOrBefore(history, startTs, decimals),
      currentPositionRaw: currentAssetsRaw,
      events,
    });
    if (result.hidden) return [];
    const earnedDecimal = rawAmountToDecimal(result.earnedRaw, decimals);
    return [{ label: row.label, raw: result.earnedRaw, usd: earnedDecimal * assetPriceUsd }];
  });
}

export function buildProjectedEarningsRows(options: {
  currentAssetsRaw: bigint;
  netApy: number;
  decimals: number;
  assetPriceUsd: number;
}): EarningsDisplayRow[] {
  const { currentAssetsRaw, netApy, decimals, assetPriceUsd } = options;
  return PROJECTED_PERIODS.map((row) => {
    const raw = projectedInterestRaw(currentAssetsRaw, netApy, row.days);
    const earnedDecimal = rawAmountToDecimal(raw, decimals);
    return { label: row.label, raw, usd: earnedDecimal * assetPriceUsd };
  });
}

const PROJECTED_GROWTH_SCALE = BigInt(1_000_000_000);

/**
 * Estimate interest over `days` if `netApy` holds, with annual compounding:
 * position × ((1 + APY)^(days/365) − 1).
 */
export function projectedInterestRaw(
  currentAssetsRaw: bigint,
  netApy: number,
  days: number
): bigint {
  if (
    currentAssetsRaw <= BigInt(0) ||
    !Number.isFinite(netApy) ||
    netApy <= 0 ||
    days <= 0
  ) {
    return BigInt(0);
  }
  const growth = Math.pow(1 + netApy, days / 365) - 1;
  if (!Number.isFinite(growth) || growth <= 0) return BigInt(0);
  const growthScaled = BigInt(Math.round(growth * Number(PROJECTED_GROWTH_SCALE)));
  if (growthScaled <= BigInt(0)) return BigInt(0);
  return (currentAssetsRaw * growthScaled) / PROJECTED_GROWTH_SCALE;
}
