import { findVaultByAddress, getVaultAnalyticsUrl } from '@/lib/vault-utils';
import { fetchMorphoGraphQL, readMorphoGraphQLResponse } from '@/lib/api-utils';
import {
  formatMorphoMarketName,
  getMorphoMarketUrl,
  type MorphoMarketRateType,
} from '@/lib/morpho-market-url';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';

export type VaultAllocationKind = 'market' | 'idle' | 'vault';

export interface VaultMarketAllocation {
  id: string;
  kind: VaultAllocationKind;
  marketId?: string;
  name: string;
  morphoUrl?: string;
  /** Underlying vault address when kind is `vault`. */
  vaultAddress?: string;
  /** Analytics page for an underlying vault allocation (`kind: 'vault'`). */
  href?: string;
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
  /** Morpho Blue variable vs fixed rate market. */
  rateType?: MorphoMarketRateType;
  /** LLTV raw from Morpho (1e18 scale). */
  lltv?: string | number | null;
  /** 0 = top-level; 1 = nested under an underlying vault group header. */
  nestLevel?: number;
  /** Underlying vault row id when this market/idle sits under a wrapper allocation. */
  parentId?: string;
  /** Underlying vault totalAssets raw — used to scale nested wrapper allocations, omitted from API JSON. */
  innerTotalAssetsRaw?: string;
}

export interface VaultAllocationData {
  allocations: VaultMarketAllocation[];
}

const MARKET_V1_ADAPTER_SELECTION = `
          ... on MorphoMarketV1Adapter {
            positions(first: 100) {
              items {
                market {
                  marketId
                  lltv
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
`;

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
          ${MARKET_V1_ADAPTER_SELECTION}
          ... on MorphoVaultV2Adapter {
            assets
            assetsUsd
            innerVault {
              address
              name
              symbol
              totalAssets
              totalAssetsUsd
              liquidityUsd
              netApy
              asset {
                symbol
                decimals
              }
            }
          }
        }
      }
    }
  }
`;

type InnerVaultGraphQL = {
  address?: string;
  name?: string;
  symbol?: string;
  totalAssets?: number | string;
  totalAssetsUsd?: number;
  liquidityUsd?: number;
  netApy?: number;
  asset?: { symbol?: string; decimals?: number };
};

type AdapterItem = {
  __typename?: string;
  assets?: number | string;
  assetsUsd?: number;
  innerVault?: InnerVaultGraphQL;
  positions?: {
    items?: Array<{
      market?: {
        marketId?: string;
        lltv?: number | string;
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
  if (!Number.isSafeInteger(value)) {
    return morphoRawAmount(value.toLocaleString('fullwide', { useGrouping: false }));
  }
  return BigInt(value).toString();
}

function addRawAmounts(a: string, b: string): string {
  try {
    return (BigInt(a || '0') + BigInt(b || '0')).toString();
  } catch {
    return a || '0';
  }
}

/** MorphoMarketV1Adapter positions are Blue variable-rate markets. */
function resolveMorphoAdapterRateType(
  adapterTypename: string | undefined
): MorphoMarketRateType {
  if (adapterTypename?.toLowerCase().includes('fixed')) return 'fixed';
  return 'variable';
}

function scaleUsd(
  value: number,
  numeratorUsd: number,
  denominatorUsd: number
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(denominatorUsd) || denominatorUsd <= 0) return value;
  if (!Number.isFinite(numeratorUsd) || numeratorUsd <= 0) return 0;
  const share = Math.min(numeratorUsd / denominatorUsd, 1);
  return value * share;
}

function scaleRaw(raw: string, numerator: string, denominator: string): string {
  try {
    const n = BigInt(numerator || '0');
    const d = BigInt(denominator || '0');
    const r = BigInt(raw || '0');
    if (r === BigInt(0) || n === BigInt(0)) return '0';
    if (d === BigInt(0) || n >= d) return r.toString();
    return ((r * n) / d).toString();
  } catch {
    return '0';
  }
}

function isPositiveRaw(raw: string): boolean {
  try {
    return BigInt(raw || '0') > BigInt(0);
  } catch {
    return false;
  }
}

function buildIdleRow(args: {
  id: string;
  assetSymbol: string;
  assetDecimals: number;
  idleAssetsUsd: number;
  idleAssetsRaw: string;
  idleApy: number | null;
  nestLevel?: number;
  parentId?: string;
}): VaultMarketAllocation | null {
  const idleAllocatedUsd = Number.isFinite(args.idleAssetsUsd) ? args.idleAssetsUsd : 0;
  const hasIdle = idleAllocatedUsd > 0 || isPositiveRaw(args.idleAssetsRaw);
  if (!hasIdle) return null;

  return {
    id: args.id,
    kind: 'idle',
    name: `${args.assetSymbol} (Idle)`,
    allocatedUsd: idleAllocatedUsd,
    allocatedAssetsRaw: args.idleAssetsRaw,
    tokenSymbol: args.assetSymbol,
    tokenDecimals: args.assetDecimals,
    marketSizeUsd: null,
    liquidityUsd: idleAllocatedUsd,
    apy: args.idleApy,
    nestLevel: args.nestLevel,
    parentId: args.parentId,
  };
}

function parseMarketRowsFromAdapters(
  items: AdapterItem[],
  chainId: number,
  fallbackAssetSymbol: string,
  options: {
    nestLevel?: number;
    parentId?: string;
    scaleAllocatedUsd?: (usd: number) => number;
    scaleAllocatedRaw?: (raw: string) => string;
  } = {}
): VaultMarketAllocation[] {
  const nestLevel = options.nestLevel ?? 0;
  const byMarketId = new Map<string, VaultMarketAllocation>();

  for (const adapter of items) {
    if (adapter.__typename !== 'MorphoMarketV1Adapter') continue;

    for (const position of adapter.positions?.items ?? []) {
      const market = position.market;
      const marketId = market?.marketId;
      const loanSymbol = market?.loanAsset?.symbol;
      const collateralSymbol = market?.collateralAsset?.symbol;
      const loanDecimals = resolveAssetDecimals(
        loanSymbol ?? fallbackAssetSymbol,
        market?.loanAsset?.decimals
      );

      if (!marketId || !loanSymbol || !collateralSymbol) continue;

      const allocatedUsd = Number(position.state?.supplyAssetsUsd ?? 0);
      const allocatedAssetsRaw = morphoRawAmount(position.state?.supplyAssets);
      if (allocatedUsd <= 0 && !isPositiveRaw(allocatedAssetsRaw)) continue;

      const scaledUsd = options.scaleAllocatedUsd
        ? options.scaleAllocatedUsd(allocatedUsd)
        : allocatedUsd;
      const scaledRaw = options.scaleAllocatedRaw
        ? options.scaleAllocatedRaw(allocatedAssetsRaw)
        : allocatedAssetsRaw;
      if (scaledUsd <= 0 && !isPositiveRaw(scaledRaw)) continue;

      const marketApy = market.state?.netSupplyApy;
      const apy =
        marketApy != null && Number.isFinite(Number(marketApy))
          ? Number(marketApy)
          : null;

      const marketSizeUsd = Number(market.state?.supplyAssetsUsd ?? 0);
      const liquidityUsd = Number(market.state?.liquidityAssetsUsd ?? 0);
      const rowId = options.parentId ? `${options.parentId}:${marketId}` : marketId;

      const existing = byMarketId.get(rowId);
      if (existing) {
        existing.allocatedUsd += scaledUsd;
        existing.allocatedAssetsRaw = addRawAmounts(existing.allocatedAssetsRaw, scaledRaw);
        continue;
      }

      byMarketId.set(rowId, {
        id: rowId,
        kind: 'market',
        marketId,
        name: formatMorphoMarketName(collateralSymbol, loanSymbol),
        morphoUrl: getMorphoMarketUrl(chainId, marketId, collateralSymbol, loanSymbol),
        allocatedUsd: scaledUsd,
        allocatedAssetsRaw: scaledRaw,
        tokenSymbol: loanSymbol,
        tokenDecimals: loanDecimals,
        marketSizeUsd: Number.isFinite(marketSizeUsd) ? marketSizeUsd : null,
        liquidityUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
        apy,
        loanSymbol,
        collateralSymbol,
        rateType: resolveMorphoAdapterRateType(adapter.__typename),
        lltv: market.lltv ?? null,
        nestLevel,
        parentId: options.parentId,
      });
    }
  }

  return Array.from(byMarketId.values()).sort((a, b) => b.allocatedUsd - a.allocatedUsd);
}

export function parseVaultV2AllocationsFromGraphQL(
  vault: VaultAllocationGraphQL,
  chainId: number
): VaultAllocationData {
  const assetSymbol = vault.asset?.symbol ?? 'Asset';
  const assetDecimals = resolveAssetDecimals(assetSymbol, vault.asset?.decimals);
  const idleApy =
    vault.asset?.yield?.apr != null ? Number(vault.asset.yield.apr) : null;

  const items = vault.adapters?.items ?? [];
  const vaultRows: VaultMarketAllocation[] = [];

  for (const adapter of items) {
    if (adapter.__typename !== 'MorphoVaultV2Adapter' || !adapter.innerVault?.address) {
      continue;
    }

    const inner = adapter.innerVault;
    const innerAddress = inner.address;
    if (!innerAddress) continue;

    const tokenSymbol = inner.asset?.symbol ?? vault.asset?.symbol ?? assetSymbol;
    const tokenDecimals = resolveAssetDecimals(
      tokenSymbol,
      inner.asset?.decimals ?? vault.asset?.decimals
    );
    const allocatedUsd = Number(adapter.assetsUsd ?? 0);
    const allocatedAssetsRaw = morphoRawAmount(adapter.assets);
    const innerApy =
      inner.netApy != null && Number.isFinite(Number(inner.netApy))
        ? Number(inner.netApy)
        : null;
    const innerTvl = Number(inner.totalAssetsUsd ?? 0);
    const innerLiquidity = Number(inner.liquidityUsd ?? 0);
    const innerTotalAssetsRaw = morphoRawAmount(inner.totalAssets);
    const registry = findVaultByAddress(innerAddress);

    const header: VaultMarketAllocation = {
      id: innerAddress,
      kind: 'vault',
      vaultAddress: innerAddress,
      name: registry?.name || inner.name || inner.symbol || 'Vault',
      href: getVaultAnalyticsUrl(innerAddress),
      allocatedUsd: Number.isFinite(allocatedUsd) ? allocatedUsd : 0,
      allocatedAssetsRaw,
      tokenSymbol,
      tokenDecimals,
      marketSizeUsd: Number.isFinite(innerTvl) ? innerTvl : null,
      liquidityUsd: Number.isFinite(innerLiquidity) ? innerLiquidity : null,
      apy: innerApy,
      nestLevel: 0,
      innerTotalAssetsRaw: innerTotalAssetsRaw,
    };
    vaultRows.push(header);
  }

  const marketRows = parseMarketRowsFromAdapters(items, chainId, assetSymbol);

  const idleRow = buildIdleRow({
    id: 'idle',
    assetSymbol,
    assetDecimals,
    idleAssetsUsd: Number(vault.idleAssetsUsd ?? 0),
    idleAssetsRaw: morphoRawAmount(vault.idleAssets),
    idleApy,
  });

  const allocations = [...(idleRow ? [idleRow] : []), ...vaultRows, ...marketRows];

  return { allocations };
}

function omitInnerScalingFields(row: VaultMarketAllocation): VaultMarketAllocation {
  const rest = { ...row };
  delete rest.innerTotalAssetsRaw;
  return rest;
}

function nestScaledInnerAllocations(
  innerAllocations: VaultMarketAllocation[],
  header: VaultMarketAllocation
): VaultMarketAllocation[] {
  const innerTvl = header.marketSizeUsd ?? 0;
  const denominatorRaw = header.innerTotalAssetsRaw ?? '0';
  if (!isPositiveRaw(denominatorRaw)) return [];
  const nested: VaultMarketAllocation[] = [];

  for (const row of innerAllocations) {
    if (row.kind === 'vault') continue;

    const scaledUsd =
      Number.isFinite(innerTvl) && innerTvl > 0
        ? scaleUsd(row.allocatedUsd, header.allocatedUsd, innerTvl)
        : 0;
    const scaledRaw = scaleRaw(
      row.allocatedAssetsRaw,
      header.allocatedAssetsRaw,
      denominatorRaw
    );
    if (scaledUsd <= 0 && !isPositiveRaw(scaledRaw)) continue;

    nested.push({
      ...row,
      id: `${header.id}:${row.id}`,
      allocatedUsd: scaledUsd,
      allocatedAssetsRaw: scaledRaw,
      liquidityUsd: row.kind === 'idle' ? scaledUsd : row.liquidityUsd,
      nestLevel: 1,
      parentId: header.id,
    });
  }

  return nested;
}

async function expandWrapperInnerMarkets(
  parsed: VaultAllocationData,
  chainId: number
): Promise<VaultAllocationData> {
  const headers = parsed.allocations.filter((row) => row.kind === 'vault');
  if (headers.length === 0) return parsed;

  const nestedByHeader = await Promise.all(
    headers.map(async (header) => {
      if (!header.vaultAddress) return [header];
      const inner = await fetchVaultV2AllocationData(header.vaultAddress, chainId, {
        expandInnerVaults: false,
      });
      if (inner.allocations.length === 0) {
        if (inner.error) {
          logger.warn('Underlying vault allocations unavailable', {
            innerVault: header.vaultAddress,
            error: inner.error,
            rateLimited: inner.rateLimited,
          });
        }
        return [header];
      }
      return [header, ...nestScaledInnerAllocations(inner.allocations, header)];
    })
  );

  const idle = parsed.allocations.filter((row) => row.kind === 'idle');
  const markets = parsed.allocations.filter((row) => row.kind === 'market');

  return {
    allocations: [...idle, ...nestedByHeader.flat(), ...markets],
  };
}

export async function fetchVaultV2AllocationData(
  vaultAddress: string,
  chainId: number,
  options: { expandInnerVaults?: boolean } = {}
): Promise<VaultAllocationData & { error?: string; rateLimited?: boolean }> {
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
        return {
          allocations: [],
          error: 'Morpho API rate limit exceeded',
          rateLimited: true,
        };
      }
      return { allocations: [], error: `Morpho API error: ${response.status}` };
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
      return { allocations: [], error: 'Failed to load market allocations' };
    }

    const vault = data.data?.vaultV2ByAddress;
    if (!vault) {
      return { allocations: [], error: 'Vault not found' };
    }

    const parsed = parseVaultV2AllocationsFromGraphQL(vault, chainId);
    const expanded =
      options.expandInnerVaults === false
        ? parsed
        : await expandWrapperInnerMarkets(parsed, chainId);

    return {
      ...expanded,
      allocations: expanded.allocations.map(omitInnerScalingFields),
    };
  } catch (err) {
    logger.error(
      'Failed to fetch vault market allocations',
      err instanceof Error ? err : new Error(String(err)),
      { vaultAddress, chainId }
    );
    return {
      allocations: [],
      error: err instanceof Error ? err.message : 'Failed to load market allocations',
    };
  }
}
