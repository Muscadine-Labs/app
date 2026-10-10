// API Response Types

export interface GraphQLError {
  message: string;
  status?: string;
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

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

export interface GraphQLTransactionsData {
  vaultV2transactions?: {
    items: GraphQLV2TransactionItem[];
  };
}

// V2 Transaction Item
export interface GraphQLV2TransactionItem {
  txHash: string;
  timestamp: number;
  type: string;
  blockNumber?: number;
  txIndex?: number;
  vault?: {
    address: string;
  };
  shares?: string;
  data?: {
    __typename?: string;
    assets?: number;
    sender?: string;
    onBehalf?: string;
    receiver?: string;
    from?: string;
    to?: string;
  };
}

// Alchemy API Types
export interface AlchemyTokenBalance {
  contractAddress: string;
  tokenBalance: string;
}

export interface AlchemyTokenMetadata {
  decimals: number;
  symbol: string;
  name?: string;
}

export interface AlchemyTokenBalancesResponse {
  result?: {
    tokenBalances: AlchemyTokenBalance[];
  };
  error?: {
    code: number;
    message: string;
  };
}

export interface AlchemyTokenMetadataResponse {
  result?: AlchemyTokenMetadata;
  error?: {
    code: number;
    message: string;
  };
}

