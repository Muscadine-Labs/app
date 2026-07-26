import { fetchMorphoGraphQL, readMorphoGraphQLResponse } from '@/lib/api-utils';
import {
  formatMorphoMarketName,
  getMorphoMarketUrl,
} from '@/lib/morpho-market-url';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';

export type VaultAllocationKind = 'market' | 'idle';

export interface VaultMarketAllocation {
  id: string;
  kind: VaultAllocationKind;
  marketId?: string;
  name: string;
  morphoUrl?: string;
  allocatedUsd: number;
  /** Null for idle — not applicable. */
  marketSizeUsd: number | null;
  liquidityUsd: number | null;
  /** Supply APY decimal (e.g. 0.051 = 5.1%). Null when unknown. */
  apy: number | null;
  /** Allocated amount in smallest token units (loan asset for markets, vault asset for idle). */
  allocatedAssetsRaw: string;
  tokenSymbol: string;
  tokenDecimals: number;
  loanSymbol?: string;
  collateralSymbol?: string;
}

export interface VaultAllocationData {
  allocations: VaultMarketAllocation[];
  /** Allocation-weighted net supply APY — matches Morpho vault deposit widget. */
  weightedNetApy: number | null;
}

const VAULT_ALLOCATIONS_QUERY = `
  query VaultV2Allocations($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      idleAssets
      idleAssetsUsd
      asset {
        symbol
        decimals
        yield {
          apr
        }
      }
      adapters(first: 20) {
        items {
          __typename
          ... on MorphoMarketV1Adapter {
            positions(first: 100) {
              items {
                market {
                  marketId
                  loanAsset {
                    symbol
                    decimals
                  }
                  collateralAsset {
                    symbol
                  }
                  state {
                    supplyAssetsUsd
                    liquidityAssetsUsd
                    netSupplyApy
                  }
                }
                state {
                  supplyAssets
                  supplyAssetsUsd
                }
              }
            }
          }
        }
      }
    }
  }
`;

type AdapterItem = {
  __typename?: string;
  positions?: {
    items?: Array<{
      market?: {
        marketId?: string;
        loanAsset?: { symbol?: string; decimals?: number };
        collateralAsset?: { symbol?: string };
        state?: {
          supplyAssetsUsd?: number;
          liquidityAssetsUsd?: number;
          netSupplyApy?: number;
        };
      };
      state?: {
        supplyAssets?: number | string;
        supplyAssetsUsd?: number;
      };
    }>;
  };
};

type VaultAllocationGraphQL = {
  idleAssets?: number | string;
  idleAssetsUsd?: number;
  asset?: {
    symbol?: string;
    decimals?: number;
    yield?: { apr?: number | null } | null;
  };
  adapters?: { items?: AdapterItem[] };
};

function morphoRawAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'string') {
    const trimmed = value.includes('.') ? value.split('.')[0] : value;
    if (!trimmed || trimmed === '0') return '0';
    try {
      return BigInt(trimmed).toString();
    } catch {
      return '0';
    }
  }
  if (!Number.isFinite(value) || value <= 0) return '0';
  return BigInt(Math.round(value)).toString();
}

function addRawAmounts(a: string, b: string): string {
  try {
    return (BigInt(a || '0') + BigInt(b || '0')).toString();
  } catch {
    return a || '0';
  }
}

/** Weighted net supply APY across vault positions + idle (matches Morpho UI). */
export function computeWeightedVaultNetApy(
  positions: Array<{ supplyAssetsUsd: number; netSupplyApy: number }>,
  idleAssetsUsd: number,
  idleApy: number | null | undefined
): number | null {
  let totalUsd = 0;
  let weighted = 0;

  for (const position of positions) {
    if (position.supplyAssetsUsd <= 0) continue;
    totalUsd += position.supplyAssetsUsd;
    weighted += position.supplyAssetsUsd * position.netSupplyApy;
  }

  if (idleAssetsUsd > 0) {
    totalUsd += idleAssetsUsd;
    weighted += idleAssetsUsd * (idleApy ?? 0);
  }

  if (totalUsd <= 0) return null;
  return weighted / totalUsd;
}

export function parseVaultV2AllocationsFromGraphQL(
  vault: VaultAllocationGraphQL,
  chainId: number
): VaultAllocationData {
  const assetSymbol = vault.asset?.symbol ?? 'Asset';
  const assetDecimals = resolveAssetDecimals(assetSymbol, vault.asset?.decimals);
  const idleAssetsUsd = Number(vault.idleAssetsUsd ?? 0);
  const idleAssetsRaw = morphoRawAmount(vault.idleAssets);
  const idleApy =
    vault.asset?.yield?.apr != null ? Number(vault.asset.yield.apr) : null;

  const items = vault.adapters?.items ?? [];
  const byMarketId = new Map<string, VaultMarketAllocation>();

  for (const adapter of items) {
    if (adapter.__typename !== 'MorphoMarketV1Adapter') continue;

    for (const position of adapter.positions?.items ?? []) {
      const market = position.market;
      const marketId = market?.marketId;
      const loanSymbol = market?.loanAsset?.symbol;
      const collateralSymbol = market?.collateralAsset?.symbol;
      const loanDecimals = resolveAssetDecimals(
        loanSymbol ?? assetSymbol,
        market?.loanAsset?.decimals
      );

      if (!marketId || !loanSymbol || !collateralSymbol) continue;

      const allocatedUsd = Number(position.state?.supplyAssetsUsd ?? 0);
      const allocatedAssetsRaw = morphoRawAmount(position.state?.supplyAssets);
      const marketApy = market.state?.netSupplyApy;
      const apy =
        marketApy != null && Number.isFinite(Number(marketApy))
          ? Number(marketApy)
          : null;

      if (allocatedUsd <= 0) continue;

      const marketSizeUsd = Number(market.state?.supplyAssetsUsd ?? 0);
      const liquidityUsd = Number(market.state?.liquidityAssetsUsd ?? 0);

      const existing = byMarketId.get(marketId);
      if (existing) {
        existing.allocatedUsd += allocatedUsd;
        existing.allocatedAssetsRaw = addRawAmounts(
          existing.allocatedAssetsRaw,
          allocatedAssetsRaw
        );
        continue;
      }

      byMarketId.set(marketId, {
        id: marketId,
        kind: 'market',
        marketId,
        name: formatMorphoMarketName(collateralSymbol, loanSymbol),
        morphoUrl: getMorphoMarketUrl(chainId, marketId, collateralSymbol, loanSymbol),
        allocatedUsd,
        allocatedAssetsRaw,
        tokenSymbol: loanSymbol,
        tokenDecimals: loanDecimals,
        marketSizeUsd: Number.isFinite(marketSizeUsd) ? marketSizeUsd : null,
        liquidityUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
        apy,
        loanSymbol,
        collateralSymbol,
      });
    }
  }

  const marketRows = Array.from(byMarketId.values()).sort(
    (a, b) => b.allocatedUsd - a.allocatedUsd
  );

  const idleRow: VaultMarketAllocation = {
    id: 'idle',
    kind: 'idle',
    name: `${assetSymbol} (Idle)`,
    allocatedUsd: Number.isFinite(idleAssetsUsd) ? idleAssetsUsd : 0,
    allocatedAssetsRaw: idleAssetsRaw,
    tokenSymbol: assetSymbol,
    tokenDecimals: assetDecimals,
    marketSizeUsd: null,
    liquidityUsd: Number.isFinite(idleAssetsUsd) ? idleAssetsUsd : 0,
    apy: idleApy,
  };

  const allocations = [idleRow, ...marketRows];

  const weightInputs = marketRows
    .filter((row) => row.allocatedUsd > 0)
    .map((row) => ({
      supplyAssetsUsd: row.allocatedUsd,
      netSupplyApy: row.apy ?? 0,
    }));

  const weightedNetApy = computeWeightedVaultNetApy(
    weightInputs,
    idleRow.allocatedUsd,
    idleApy
  );

  return { allocations, weightedNetApy };
}

export async function fetchVaultV2AllocationData(
  vaultAddress: string,
  chainId: number
): Promise<VaultAllocationData & { error?: string }> {
  try {
    const response = await fetchMorphoGraphQL(
      {
        query: VAULT_ALLOCATIONS_QUERY,
        variables: { address: vaultAddress, chainId },
      },
      {
        revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS,
        tags: [`vault-allocations-${vaultAddress}-${chainId}`],
      }
    );

    const { responseText, rateLimited } = await readMorphoGraphQLResponse(response);

    if (!response.ok) {
      if (rateLimited) {
        return { allocations: [], weightedNetApy: null, error: 'Morpho API rate limit exceeded' };
      }
      return { allocations: [], weightedNetApy: null, error: `Morpho API error: ${response.status}` };
    }

    const data = JSON.parse(responseText) as {
      errors?: unknown[];
      data?: { vaultV2ByAddress?: VaultAllocationGraphQL };
    };

    if (data.errors?.length) {
      logger.warn('Vault allocations GraphQL errors', {
        vaultAddress,
        chainId,
        errors: data.errors,
      });
      return { allocations: [], weightedNetApy: null, error: 'Failed to load market allocations' };
    }

    const vault = data.data?.vaultV2ByAddress;
    if (!vault) {
      return { allocations: [], weightedNetApy: null, error: 'Vault not found' };
    }

    return parseVaultV2AllocationsFromGraphQL(vault, chainId);
  } catch (err) {
    logger.error(
      'Failed to fetch vault market allocations',
      err instanceof Error ? err : new Error(String(err)),
      { vaultAddress, chainId }
    );
    return {
      allocations: [],
      weightedNetApy: null,
      error: err instanceof Error ? err.message : 'Failed to load market allocations',
    };
  }
}

/** @deprecated Use fetchVaultV2AllocationData */
export async function fetchVaultV2MarketAllocations(
  vaultAddress: string,
  chainId: number
): Promise<{ allocations: VaultMarketAllocation[]; error?: string }> {
  const result = await fetchVaultV2AllocationData(vaultAddress, chainId);
  return { allocations: result.allocations, error: result.error };
}
