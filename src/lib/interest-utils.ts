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

  const netDeposits = totalDeposits - totalWithdrawals;
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
