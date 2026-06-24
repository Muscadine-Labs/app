import type {
  GraphQLResponse,
  GraphQLTransactionsData,
  GraphQLV2TransactionItem,
  Transaction,
} from '@/types/api';
import { DEFAULT_ASSET_PRICE, DEFAULT_ASSET_DECIMALS, STABLECOIN_SYMBOLS, MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { fetchMorphoGraphQL, resolveMorphoAssetPriceUsd } from '@/lib/api-utils';

export interface VaultV2ActivityData {
  transactions: Transaction[];
  deposits: Transaction[];
  withdrawals: Transaction[];
  events: Transaction[];
  assetPriceUsd: number;
  assetDecimals: number;
  error?: string;
}

/**
 * Fetch v2 vault deposit/withdraw activity from Morpho GraphQL (no internal HTTP).
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
    query VaultV2Activity($vaultAddress: String!, $userAddressIn: [String!], $first: Int!) {
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
            ... on VaultV2DepositData {
              assets
              sender
              onBehalf
            }
            ... on VaultV2WithdrawData {
              assets
              sender
              onBehalf
            }
          }
        }
      }
    }
  `;

  let data: GraphQLResponse<GraphQLTransactionsData>;

  try {
    const response = await fetchMorphoGraphQL(
      {
        query,
        variables: {
          vaultAddress,
          userAddressIn: userAddress ? [userAddress] : null,
          first: transactionLimit,
        },
      },
      { revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS, tags: [`vault-${vaultAddress}-${chainId}`] }
    );

    const responseText = await response.text();

    try {
      data = JSON.parse(responseText) as GraphQLResponse<GraphQLTransactionsData>;
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

  const vaultTxs = data.data?.vaultV2transactions?.items || [];
  let assetPrice = DEFAULT_ASSET_PRICE;
  let assetDecimals = DEFAULT_ASSET_DECIMALS;

  try {
    const vaultQuery = `
      query VaultAssetInfo($address: String!, $chainId: Int!) {
        vaultV2ByAddress(address: $address, chainId: $chainId) {
          asset {
            symbol
            decimals
            price {
              usd
            }
          }
        }
      }
    `;

    const vaultResponse = await fetchMorphoGraphQL(
      {
        query: vaultQuery,
        variables: { address: vaultAddress, chainId },
      },
      { tags: [`vault-${vaultAddress}-${chainId}`] }
    );

    if (vaultResponse.ok) {
      const vaultData = await vaultResponse.json();
      const vaultInfo = vaultData.data?.vaultV2ByAddress;
      if (vaultInfo?.asset) {
        assetDecimals = vaultInfo.asset.decimals || DEFAULT_ASSET_DECIMALS;
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
    }
  } catch (error) {
    logger.error(
      'Failed to fetch vault asset info',
      error instanceof Error ? error : new Error(String(error)),
      { vaultAddress, chainId }
    );
  }

  const transactions: Transaction[] = vaultTxs
    .map((tx: GraphQLV2TransactionItem) => {
      let assetsRaw: string | undefined;
      if (tx.data?.assets !== undefined && tx.data.assets !== null) {
        assetsRaw = tx.data.assets.toString();
      }

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

      const transactionType =
        tx.type === 'Deposit'
          ? ('deposit' as const)
          : tx.type === 'Withdraw'
            ? ('withdraw' as const)
            : ('event' as const);

      const userAddr = tx.data?.sender || tx.data?.onBehalf;

      return {
        id: tx.txHash,
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

  const deposits = transactions.filter((tx: Transaction) => tx.type === 'deposit');
  const withdrawals = transactions.filter((tx: Transaction) => tx.type === 'withdraw');
  const events = transactions.filter(
    (tx: Transaction) => tx.type !== 'deposit' && tx.type !== 'withdraw'
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
