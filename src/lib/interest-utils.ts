import type { Transaction } from '@/types/api';

/**
 * Earned interest = current assets − net deposits (deposits − withdrawals).
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
    if (tx.assets) {
      try {
        totalDeposits += BigInt(tx.assets);
      } catch {
        // skip malformed
      }
    }
  }

  let totalWithdrawals = BigInt(0);
  for (const tx of withdrawals) {
    if (tx.assets) {
      try {
        totalWithdrawals += BigInt(tx.assets);
      } catch {
        // skip malformed
      }
    }
  }

  const netDeposits = totalDeposits - totalWithdrawals;
  const earned = currentAssetsRaw - netDeposits;
  return earned > BigInt(0) ? earned : BigInt(0);
}
