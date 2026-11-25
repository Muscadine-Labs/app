import type { Transaction, TransactionType } from '@/types/api';
import { DEFAULT_ASSET_DECIMALS, DEFAULT_ASSET_PRICE, STABLECOIN_SYMBOLS } from '@/lib/constants';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
import { logger } from '@/lib/logger';
import { getRestVault, getRestVaultState, toBigInt, tryGetRestTokenPriceUsd } from '@/lib/morpho-rest-data';
import { fetchPositionActivity, type RestActivityItem } from '@/lib/morpho-rest-wallet';
import { fetchSharePriceLookup, sharesToAssetsAt, sharesToAssetsRaw } from '@/lib/vault-v2-historical-ratio';

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
 * Morpho REST has no vault-wide activity route (GraphQL `vaultV2transactions` without a user
 * did). Nothing in the app reads a vault-wide feed, so only a wallet's own activity exists.
 */
export const VAULT_WIDE_ACTIVITY_UNAVAILABLE = 'Vault-wide activity is not available';

function transactionType(type: string): TransactionType {
  switch (type) {
    case 'deposit':
      return 'deposit';
    case 'withdraw':
      return 'withdraw';
    case 'shares_transfer_in':
      return 'transfer_in';
    case 'shares_transfer_out':
      return 'transfer_out';
    default:
      return 'event';
  }
}

function countsTowardDeposits(type: TransactionType): boolean {
  return type === 'deposit' || type === 'transfer_in';
}

function countsTowardWithdrawals(type: TransactionType): boolean {
  return type === 'withdraw' || type === 'transfer_out';
}

function isTransfer(item: RestActivityItem): boolean {
  return item.type === 'shares_transfer_in' || item.type === 'shares_transfer_out';
}

/**
 * One wallet's deposits, withdrawals and share transfers in one vault, from Morpho REST
 * `/users/{u}/position/activity`. Transfer rows carry shares only: they are valued at the
 * vault's share price at that time (REST `state/history`), else today's.
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
  if (!userAddress) return { ...empty, error: VAULT_WIDE_ACTIVITY_UNAVAILABLE };

  let items: RestActivityItem[];
  let vault: Awaited<ReturnType<typeof getRestVault>>;
  try {
    [items, vault] = await Promise.all([
      fetchPositionActivity(chainId, vaultAddress, userAddress),
      getRestVault(chainId, vaultAddress),
    ]);
  } catch (error) {
    logger.warn('Failed to fetch vault activity from Morpho', {
      vaultAddress,
      chainId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...empty, error: 'Failed to connect to Morpho API' };
  }

  const symbol = vault.asset.symbol ?? '';
  const assetDecimals = resolveAssetDecimals(symbol, vault.asset.decimals);
  const isStable = STABLECOIN_SYMBOLS.includes(symbol.toUpperCase() as (typeof STABLECOIN_SYMBOLS)[number]);
  const price = await tryGetRestTokenPriceUsd(chainId, vault.asset.address);
  // Unknown price: a stablecoin is $1, anything else 0 (never $1 per token).
  const assetPrice = price ?? (isStable ? 1 : 0);

  const transferTimes = items
    .filter(isTransfer)
    .map((item) => item.timestamp)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const [sharePrices, spotState] = await Promise.all([
    transferTimes.length > 0
      ? fetchSharePriceLookup({ vaultAddress, chainId, earliestTimestamp: Math.min(...transferTimes) })
      : Promise.resolve(null),
    transferTimes.length > 0 ? getRestVaultState(chainId, vaultAddress).catch(() => null) : Promise.resolve(null),
  ]);
  const spotTotals = spotState
    ? { totalAssets: toBigInt(spotState.total_assets), totalSupply: toBigInt(spotState.total_supply) }
    : null;

  const seen = new Set<string>();
  const transactions: Transaction[] = [];
  for (const item of items) {
    if (!item.tx_hash) continue;
    const key = `${item.tx_hash.toLowerCase()}:${item.log_index ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const type = transactionType(item.type);
    const shares = item.data?.shares ?? undefined;
    let assets = item.data?.assets ?? undefined;
    if (!assets && isTransfer(item)) {
      assets =
        (sharePrices && item.timestamp ? sharesToAssetsAt(sharePrices, shares, item.timestamp) : undefined) ??
        (spotTotals ? sharesToAssetsRaw(shares, spotTotals) : undefined);
    }
    let assetsUsd = 0;
    if (assets) {
      try {
        assetsUsd = (Number(BigInt(assets)) / 10 ** assetDecimals) * assetPrice;
      } catch {
        assetsUsd = 0;
      }
    }
    const counterparty =
      item.type === 'shares_transfer_in'
        ? item.data?.from_address
        : item.type === 'shares_transfer_out'
          ? item.data?.to_address
          : undefined;

    transactions.push({
      id: `${item.tx_hash}-${item.log_index ?? 0}`,
      type,
      timestamp: item.timestamp ?? 0,
      blockNumber: item.block_number ? Number(item.block_number) : undefined,
      transactionHash: item.tx_hash,
      user: type === 'transfer_in' || type === 'transfer_out' ? counterparty ?? userAddress : userAddress,
      assets,
      shares,
      assetsUsd,
    });
  }
  transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return {
    transactions,
    deposits: transactions.filter((tx) => countsTowardDeposits(tx.type)),
    withdrawals: transactions.filter((tx) => countsTowardWithdrawals(tx.type)),
    events: transactions.filter((tx) => !countsTowardDeposits(tx.type) && !countsTowardWithdrawals(tx.type)),
    assetPriceUsd: assetPrice,
    assetDecimals,
  };
}
