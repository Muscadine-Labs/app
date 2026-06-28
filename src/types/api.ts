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

export interface TransactionResponse {
  transactions: Transaction[];
  deposits: Transaction[];
  withdrawals: Transaction[];
  events: Transaction[];
  cached: boolean;
  timestamp: number;
  error?: string;
}

// GraphQL Transaction Item
export interface GraphQLTransactionItem {
  hash: string;
  timestamp: number;
  type: string;
  blockNumber?: number;
  chain?: {
    id: string;
    network: string;
  };
  user?: {
    address: string;
  };
  data?: {
    shares?: string;
    assets?: string;
    assetsUsd?: number;
    vault?: {
      address: string;
    };
  };
}

export interface GraphQLTransactionsData {
  transactions?: {
    items: GraphQLTransactionItem[];
  };
  vaultV2transactions?: {
    items: GraphQLV2TransactionItem[];
  };
}

// V2 Transaction Item (different structure from V1)
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

// Allocation Types
export interface AllocationMarket {
  uniqueKey?: string;
  loanAsset?: {
    symbol?: string;
    address?: string;
  };
  collateralAsset?: {
    symbol?: string;
    address?: string;
  };
}

export interface Allocation {
  market?: AllocationMarket;
  supplyAssetsUsd?: string;
}

// History Types
export interface HistoryDataPoint {
  x: number;
  y: number;
}

export interface HistoryResponse {
  history: Array<{
    timestamp: number;
    date: string;
    totalAssetsUsd: number;
    apy: number;
    netApy: number;
  }>;
  period: string;
  cached: boolean;
  timestamp: number;
  error?: string;
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

