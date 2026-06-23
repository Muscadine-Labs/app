import type { Transaction } from '@/types/api';
import { morphoAmountToRaw } from '@/lib/asset-decimals';

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

  const toRaw = (value: Transaction['assets']) => {
    const raw = morphoAmountToRaw(value as string | number | null | undefined);
    return raw === '0' ? BigInt(0) : BigInt(raw);
  };

  let totalDeposits = BigInt(0);
  for (const tx of deposits) {
    totalDeposits += toRaw(tx.assets);
  }

  let totalWithdrawals = BigInt(0);
  for (const tx of withdrawals) {
    totalWithdrawals += toRaw(tx.assets);
  }

  const netDeposits = totalDeposits - totalWithdrawals;
  const earned = currentAssetsRaw - netDeposits;
  return earned > BigInt(0) ? earned : BigInt(0);
}
