// API Response Types

// Transaction Types
export type TransactionType =
  | 'deposit'
  | 'withdraw'
  | 'transfer_in'
  | 'transfer_out'
  | 'transfer'
  | 'event';

export interface Transaction {
  id: string;
  type: TransactionType;
  timestamp: number;
  blockNumber?: number;
  transactionHash?: string;
  user?: string;
  assets?: string;
  shares?: string;
  assetsUsd?: number;
}

