import type { TransactionType } from '@/types/api';

export function formatTransactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'deposit':
      return 'Deposit';
    case 'withdraw':
      return 'Withdraw';
    case 'transfer_in':
      return 'Transfer In';
    case 'transfer_out':
      return 'Transfer Out';
    case 'transfer':
      return 'Transfer';
    case 'event':
      return 'Event';
    default:
      return 'Unknown';
  }
}

export function transactionTypeDotClass(type: TransactionType): string {
  if (type === 'deposit' || type === 'transfer_in') {
    return 'bg-[var(--success)]';
  }
  if (type === 'withdraw' || type === 'transfer_out') {
    return 'bg-[var(--danger)]';
  }
  return 'bg-[var(--foreground-muted)]';
}
