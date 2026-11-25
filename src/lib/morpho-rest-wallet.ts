import { morphoRestGet, morphoRestList, morphoSelector } from '@/lib/morpho-rest';

/** Per-wallet Morpho REST reads. Always fresh (`revalidate: 0`): charts catch up after a tx. */

const fresh = { revalidate: 0 } as const;

const positionPath = (chainId: number, vault: string, user: string) =>
  `/v0/vaults-v2/${morphoSelector(chainId, vault)}/users/${user}/position`;

export type RestPosition = { shares: string; assets: string };

/** Current shares and assets of one wallet in one vault (zeros when it never held it). */
export function fetchPosition(chainId: number, vault: string, user: string): Promise<RestPosition> {
  return morphoRestGet<RestPosition>(positionPath(chainId, vault, user), undefined, fresh);
}

/**
 * Lifetime net earnings in raw asset units (Morpho's average-cost method; kept after a full
 * withdraw), or `undefined` when Morpho has no figure.
 */
export async function fetchPositionNetEarnings(
  chainId: number,
  vault: string,
  user: string
): Promise<string | undefined> {
  const data = await morphoRestGet<{ net_earnings_assets?: string | null }>(
    `${positionPath(chainId, vault, user)}/performance`,
    undefined,
    fresh
  );
  return data.net_earnings_assets ?? undefined;
}

export type RestPositionHistoryLookback =
  | 'one_day'
  | 'seven_days'
  | 'thirty_days'
  | 'ninety_days'
  | 'one_year'
  | 'inception';

export type RestPositionHistoryPoint = { timestamp: number; shares: string; assets: string };

export function fetchPositionHistory(
  chainId: number,
  vault: string,
  user: string,
  lookback: RestPositionHistoryLookback
): Promise<RestPositionHistoryPoint[]> {
  return morphoRestGet<RestPositionHistoryPoint[]>(
    `${positionPath(chainId, vault, user)}/history`,
    { lookback },
    fresh
  );
}

export type RestActivityItem = {
  type: 'deposit' | 'withdraw' | 'shares_transfer_in' | 'shares_transfer_out' | string;
  data?: {
    shares?: string | null;
    assets?: string | null;
    from_address?: string | null;
    to_address?: string | null;
  } | null;
  block_number?: string | null;
  tx_hash?: string | null;
  log_index?: number | null;
  timestamp?: number | null;
};

/** Every deposit, withdraw and share transfer of one wallet in one vault, newest first. */
export function fetchPositionActivity(
  chainId: number,
  vault: string,
  user: string
): Promise<RestActivityItem[]> {
  return morphoRestList<RestActivityItem>(`${positionPath(chainId, vault, user)}/activity`, { limit: 1000 }, fresh);
}
