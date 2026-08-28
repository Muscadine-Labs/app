import type { Transaction } from '@/types/api';
import { morphoAmountToRaw } from '@/lib/asset-decimals';

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

export function firstPositivePositionTimestamp(
  history: ReadonlyArray<{ timestamp: number; assets: number }>
): number | null {
  let first: number | null = null;
  for (const point of history) {
    if (point.assets > 0 && (first === null || point.timestamp < first)) {
      first = point.timestamp;
    }
  }
  return first;
}

export function assetsAtOrBefore(
  history: ReadonlyArray<{ timestamp: number; assets: number }>,
  timestamp: number
): number {
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  let last = 0;
  for (const point of sorted) {
    if (point.timestamp <= timestamp) last = point.assets;
    else break;
  }
  return last;
}

/**
 * Interest accrued during a window. Hidden when the wallet had no position
 * at the start of that window (first deposit is too recent).
 */
export function periodInterestRaw(options: {
  nowTs: number;
  periodSeconds: number;
  firstPositionTs: number | null;
  startPositionRaw: bigint;
  currentPositionRaw: bigint;
  events: ReadonlyArray<ActivityFlowEvent>;
}): { hidden: boolean; earnedRaw: bigint } {
  const startTs = options.nowTs - options.periodSeconds;
  if (options.firstPositionTs === null || options.firstPositionTs > startTs) {
    return { hidden: true, earnedRaw: BigInt(0) };
  }

  const { interestRaw: nowInterest } = splitPositionValueAtPoint({
    positionValueRaw: options.currentPositionRaw,
    netDepositRaw: netDepositRawAtTime(options.events, options.nowTs),
  });
  const { interestRaw: startInterest } = splitPositionValueAtPoint({
    positionValueRaw: options.startPositionRaw,
    netDepositRaw: netDepositRawAtTime(options.events, startTs),
  });
  const earned =
    nowInterest > startInterest ? nowInterest - startInterest : BigInt(0);
  return { hidden: false, earnedRaw: earned };
}

/** Estimate interest over `days` if `netApy` (decimal, e.g. 0.05) holds. */
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
  const apyMillionths = BigInt(Math.round(netApy * 1_000_000));
  if (apyMillionths <= BigInt(0)) return BigInt(0);
  return (
    (currentAssetsRaw * apyMillionths * BigInt(days)) /
    BigInt(365 * 1_000_000)
  );
}
