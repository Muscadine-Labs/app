import type {
  GraphQLResponse,
  GraphQLTransactionsData,
  GraphQLV2TransactionItem,
  Transaction,
  TransactionType,
} from '@/types/api';
import { DEFAULT_ASSET_PRICE, DEFAULT_ASSET_DECIMALS, STABLECOIN_SYMBOLS, MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
import { logger } from '@/lib/logger';
import { fetchMorphoGraphQL, resolveMorphoAssetPriceUsd } from '@/lib/api-utils';
import {
  fetchHistoricalVaultRatios,
  lookupVaultRatioAt,
  sharesToAssetsRaw,
  type VaultRatioSnapshot,
} from '@/lib/vault-v2-historical-ratio';

export interface VaultV2ActivityData {
  transactions: Transaction[];
  deposits: Transaction[];
  withdrawals: Transaction[];
  events: Transaction[];
  assetPriceUsd: number;
  assetDecimals: number;
  error?: string;
}

type V2TxData = {
  __typename?: string;
  assets?: number | string;
  sender?: string;
  onBehalf?: string;
  receiver?: string;
  from?: string;
  to?: string;
};

function parseVaultBigInt(raw: string | number | null | undefined): bigint | null {
  if (raw === undefined || raw === null) return null;
  try {
    return BigInt(typeof raw === 'number' ? Math.floor(raw) : raw);
  } catch {
    return null;
  }
}

function isTransferTx(morphoType: string, data: V2TxData | undefined): boolean {
  return morphoType === 'Transfer' || data?.__typename === 'VaultV2TransferData';
}

function resolveTransactionType(
  morphoType: string,
  data: V2TxData | undefined,
  userAddress?: string
): TransactionType {
  if (morphoType === 'Deposit') return 'deposit';
  if (morphoType === 'Withdraw') return 'withdraw';

  if (!isTransferTx(morphoType, data)) return 'event';

  if (!userAddress) return 'transfer';

  const user = userAddress.toLowerCase();
  const to = data?.to?.toLowerCase();
  const from = data?.from?.toLowerCase();

  if (to === user) return 'transfer_in';
  if (from === user) return 'transfer_out';
  return 'transfer';
}

function resolveTransactionUser(data: V2TxData | undefined): string | undefined {
  if (!data?.__typename) {
    return data?.sender || data?.onBehalf;
  }
  switch (data.__typename) {
    case 'VaultV2DepositData':
      return data.onBehalf || data.sender;
    case 'VaultV2WithdrawData':
      return data.onBehalf || data.receiver || data.sender;
    case 'VaultV2TransferData':
      return data.to || data.from;
    default:
      return data.sender || data.onBehalf;
  }
}

function resolveSpotRatio(
  totalAssets: bigint | null,
  totalSupply: bigint | null
): VaultRatioSnapshot | null {
  if (totalAssets === null || totalSupply === null || totalSupply === BigInt(0)) {
    return null;
  }
  return { totalAssets, totalSupply };
}

function resolveTransferAssets(
  shares: string | undefined,
  timestamp: number | undefined,
  historicalLookup: Awaited<ReturnType<typeof fetchHistoricalVaultRatios>>,
  spotRatio: VaultRatioSnapshot | null
): string | undefined {
  if (historicalLookup && timestamp) {
    const historicalRatio = lookupVaultRatioAt(historicalLookup, timestamp);
    if (historicalRatio) {
      const assets = sharesToAssetsRaw(shares, historicalRatio);
      if (assets) return assets;
    }
  }

  if (spotRatio) {
    return sharesToAssetsRaw(shares, spotRatio);
  }

  return undefined;
}

function resolveTransactionAssets(
  morphoType: string,
  data: V2TxData | undefined,
  shares: string | undefined,
  timestamp: number | undefined,
  historicalLookup: Awaited<ReturnType<typeof fetchHistoricalVaultRatios>>,
  spotRatio: VaultRatioSnapshot | null
): string | undefined {
  if (data?.assets !== undefined && data.assets !== null) {
    return data.assets.toString();
  }

  if (isTransferTx(morphoType, data)) {
    return resolveTransferAssets(shares, timestamp, historicalLookup, spotRatio);
  }

  return undefined;
}

function countsTowardDeposits(type: TransactionType): boolean {
  return type === 'deposit' || type === 'transfer_in';
}

function countsTowardWithdrawals(type: TransactionType): boolean {
  return type === 'withdraw' || type === 'transfer_out';
}

/**
 * Fetch v2 vault deposit/withdraw/transfer activity from Morpho GraphQL (no internal HTTP).
 */
export async function fetchVaultV2ActivityData(
  vaultAddress: string,
  chainId: number,
  userAddress?: string
): Promise<VaultV2ActivityData> {
  const empty: VaultV2ActivityData = {
    transactions: [],
    deposits: [],
    withdrawals: [],
    events: [],
    assetPriceUsd: DEFAULT_ASSET_PRICE,
    assetDecimals: DEFAULT_ASSET_DECIMALS,
  };

  const transactionLimit = userAddress ? 1000 : 100;

  const query = `
    query VaultV2Activity($vaultAddress: String!, $userAddressIn: [String!], $first: Int!, $chainId: Int!) {
      vaultV2ByAddress(address: $vaultAddress, chainId: $chainId) {
        totalAssets
        totalSupply
        asset {
          symbol
          decimals
          price {
            usd
          }
        }
      }
      vaultV2transactions(
        first: $first
        skip: 0
        orderBy: Time
        orderDirection: Desc
        where: {
          vaultAddress_in: [$vaultAddress]
          userAddress_in: $userAddressIn
        }
      ) {
        items {
          txHash
          timestamp
          type
          blockNumber
          txIndex
          vault {
            address
          }
          shares
          data {
            __typename
            ... on VaultV2DepositData {
              assets
              sender
              onBehalf
            }
            ... on VaultV2WithdrawData {
              assets
              sender
              onBehalf
              receiver
            }
            ... on VaultV2TransferData {
              from
              to
            }
          }
        }
      }
    }
  `;

  let data: GraphQLResponse<GraphQLTransactionsData & {
    vaultV2ByAddress?: {
      totalAssets?: string | number;
      totalSupply?: string | number;
      asset?: {
        symbol?: string;
        decimals?: number;
        price?: { usd?: number };
      };
    };
  }>;

  try {
    const response = await fetchMorphoGraphQL(
      {
        query,
        variables: {
          vaultAddress,
          userAddressIn: userAddress ? [userAddress] : null,
          first: transactionLimit,
          chainId,
        },
      },
      { revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS, tags: [`vault-${vaultAddress}-${chainId}`] }
    );

    const responseText = await response.text();

    try {
      data = JSON.parse(responseText) as typeof data;
    } catch (parseError) {
      logger.error(
        'Failed to parse GraphQL response',
        parseError instanceof Error ? parseError : new Error(String(parseError)),
        { vaultAddress, chainId, responseStatus: response.status }
      );
      return { ...empty, error: 'Invalid response from Morpho API' };
    }

    if (data.errors && data.errors.length > 0) {
      logger.warn('GraphQL errors in V2 activity query', {
        vaultAddress,
        chainId,
        errors: data.errors.map((e) => e.message),
      });
      return {
        ...empty,
        error: data.errors[0]?.message || 'GraphQL query failed',
      };
    }

    if (!response.ok && !data.errors) {
      return {
        ...empty,
        error: `Morpho API error: ${response.status} ${response.statusText}`,
      };
    }
  } catch (fetchError) {
    logger.error(
      'Failed to fetch from Morpho GraphQL API',
      fetchError instanceof Error ? fetchError : new Error(String(fetchError)),
      { vaultAddress, chainId }
    );
    return { ...empty, error: 'Failed to connect to Morpho API' };
  }

  const vaultInfo = data.data?.vaultV2ByAddress;
  const vaultTxs = data.data?.vaultV2transactions?.items || [];

  let assetPrice = DEFAULT_ASSET_PRICE;
  let assetDecimals = DEFAULT_ASSET_DECIMALS;

  if (vaultInfo?.asset) {
    assetDecimals = resolveAssetDecimals(
      vaultInfo.asset.symbol ?? '',
      vaultInfo.asset.decimals
    );
    assetPrice = resolveMorphoAssetPriceUsd(vaultInfo.asset, DEFAULT_ASSET_PRICE);

    if (!resolveMorphoAssetPriceUsd(vaultInfo.asset)) {
      const symbol = vaultInfo.asset.symbol || '';
      const symbolUpper = symbol.toUpperCase();
      if (
        symbol &&
        !STABLECOIN_SYMBOLS.includes(symbolUpper as (typeof STABLECOIN_SYMBOLS)[number])
      ) {
        logger.warn('Vault asset missing USD price from Morpho', {
          symbol,
          vaultAddress,
        });
      }
    }
  }

  const spotRatio = resolveSpotRatio(
    parseVaultBigInt(vaultInfo?.totalAssets),
    parseVaultBigInt(vaultInfo?.totalSupply)
  );

  const transferTimestamps = vaultTxs
    .filter((tx) => isTransferTx(tx.type ?? '', tx.data as V2TxData | undefined))
    .map((tx) => tx.timestamp)
    .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));

  let historicalLookup: Awaited<ReturnType<typeof fetchHistoricalVaultRatios>> = null;
  if (transferTimestamps.length > 0) {
    historicalLookup = await fetchHistoricalVaultRatios({
      vaultAddress,
      chainId,
      startTimestamp: Math.min(...transferTimestamps),
      endTimestamp: Math.max(...transferTimestamps),
    });
  }

  const transactions: Transaction[] = vaultTxs
    .map((tx: GraphQLV2TransactionItem) => {
      const txData = tx.data as V2TxData | undefined;
      const morphoType = tx.type ?? '';
      const transactionType = resolveTransactionType(morphoType, txData, userAddress);
      const assetsRaw = resolveTransactionAssets(
        morphoType,
        txData,
        tx.shares,
        tx.timestamp,
        historicalLookup,
        spotRatio
      );

      let assetsUsd = 0;
      if (assetsRaw) {
        try {
          const assetsBigInt = BigInt(assetsRaw);
          const assetsDecimal = Number(assetsBigInt) / Math.pow(10, assetDecimals);
          assetsUsd = assetsDecimal * assetPrice;
        } catch {
          assetsUsd = 0;
        }
      }

      const userAddr = resolveTransactionUser(txData);
      const txIndex = tx.txIndex ?? 0;

      return {
        id: `${tx.txHash}-${txIndex}`,
        type: transactionType,
        timestamp: tx.timestamp,
        blockNumber: tx.blockNumber,
        transactionHash: tx.txHash,
        user: userAddr,
        assets: assetsRaw,
        shares: tx.shares,
        assetsUsd: assetsUsd || 0,
      };
    })
    .filter((tx: Transaction) => tx.transactionHash)
    .sort((a: Transaction, b: Transaction) => (b.timestamp || 0) - (a.timestamp || 0));

  const deposits = transactions.filter((tx: Transaction) => countsTowardDeposits(tx.type));
  const withdrawals = transactions.filter((tx: Transaction) => countsTowardWithdrawals(tx.type));
  const events = transactions.filter(
    (tx: Transaction) =>
      !countsTowardDeposits(tx.type) && !countsTowardWithdrawals(tx.type)
  );

  return {
    transactions,
    deposits,
    withdrawals,
    events,
    assetPriceUsd: assetPrice,
    assetDecimals,
  };
}
