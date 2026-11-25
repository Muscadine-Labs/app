import { isMorphoRestNotFound, isMorphoRestRateLimited } from '@/lib/morpho-rest';
import {
  allRestCaps,
  getRestVault,
  getRestVaultAllocations,
  getRestVaultState,
  rawToNumber,
  toBigInt,
  type RestCap,
} from '@/lib/morpho-rest-data';
import { loadMarketDetails, loadPrices } from '@/lib/vault-v2-markets';
import {
  formatMorphoMarketName,
  getMorphoMarketUrl,
  type MorphoMarketRateType,
} from '@/lib/morpho-market-url';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
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
  /** Morpho Blue variable vs fixed rate market. */
  rateType?: MorphoMarketRateType;
  /** LLTV raw from Morpho (1e18 scale). */
  lltv?: string | number | null;
}

export interface VaultAllocationData {
  allocations: VaultMarketAllocation[];
}

/** Market caps with nothing allocated and a cap of 0 are removed markets and stay out. */
function isListedMarketCap(cap: RestCap): boolean {
  return toBigInt(cap.absolute_cap) > BigInt(0) || toBigInt(cap.allocated_assets) > BigInt(0);
}

/** The adapter's live supply in the market (interest included), else the booked allocation. */
function capSuppliedRaw(cap: RestCap): bigint {
  const live = toBigInt(cap.expected_supply_assets);
  return live > BigInt(0) ? live : toBigInt(cap.allocated_assets);
}

/** Cash not lent to a market. Always present, including at zero: it earns nothing, and its liquidity is the cash itself. */
function buildIdleRow(args: {
  assetSymbol: string;
  assetDecimals: number;
  idleAssetsRaw: bigint;
  priceUsd: number;
}): VaultMarketAllocation {
  const idleAllocatedUsd = rawToNumber(args.idleAssetsRaw, args.assetDecimals) * args.priceUsd;
  return {
    id: 'idle',
    kind: 'idle',
    name: `${args.assetSymbol} (Idle)`,
    allocatedUsd: idleAllocatedUsd,
    allocatedAssetsRaw: args.idleAssetsRaw.toString(),
    tokenSymbol: args.assetSymbol,
    tokenDecimals: args.assetDecimals,
    marketSizeUsd: null,
    liquidityUsd: idleAllocatedUsd,
    apy: 0,
  };
}

/** Allocation table rows from Morpho REST `/allocations` + each market's params and state. */
export async function loadVaultV2Allocations(
  vaultAddress: string,
  chainId: number
): Promise<VaultAllocationData> {
  const [vault, state, allocations] = await Promise.all([
    getRestVault(chainId, vaultAddress),
    getRestVaultState(chainId, vaultAddress),
    getRestVaultAllocations(chainId, vaultAddress),
  ]);
  const assetSymbol = vault.asset.symbol ?? 'Asset';
  const assetDecimals = resolveAssetDecimals(assetSymbol, vault.asset.decimals);

  const supplied = new Map<string, bigint>();
  for (const cap of allRestCaps(allocations)) {
    if (cap.cap_type !== 'market_v1' || !cap.market_id || !isListedMarketCap(cap)) continue;
    const id = cap.market_id.toLowerCase();
    supplied.set(id, (supplied.get(id) ?? BigInt(0)) + capSuppliedRaw(cap));
  }

  const markets = await loadMarketDetails(chainId, [...supplied.keys()]);
  const prices = await loadPrices(chainId, [vault.asset.address, ...markets.map((m) => m.loanToken.address)]);
  const priceOf = (token: string) => prices.get(token.toLowerCase()) ?? 0;

  const marketRows: VaultMarketAllocation[] = markets.map((m) => {
    const raw = supplied.get(m.marketId) ?? BigInt(0);
    const loanSymbol = m.loanToken.symbol ?? assetSymbol;
    const collateralSymbol = m.collateralToken?.symbol ?? '?';
    const loanDecimals = resolveAssetDecimals(loanSymbol, m.loanToken.decimals);
    const price = priceOf(m.loanToken.address);
    const supply = toBigInt(m.state.total_supply_assets);
    const borrow = toBigInt(m.state.total_borrow_assets);
    const rateType: MorphoMarketRateType = 'variable';
    return {
      id: m.marketId,
      kind: 'market',
      marketId: m.marketId,
      name: formatMorphoMarketName(collateralSymbol, loanSymbol),
      morphoUrl: getMorphoMarketUrl(chainId, m.marketId, collateralSymbol, loanSymbol, rateType),
      allocatedUsd: rawToNumber(raw, loanDecimals) * price,
      allocatedAssetsRaw: raw.toString(),
      tokenSymbol: loanSymbol,
      tokenDecimals: loanDecimals,
      marketSizeUsd: rawToNumber(supply, loanDecimals) * price,
      liquidityUsd: rawToNumber(supply > borrow ? supply - borrow : BigInt(0), loanDecimals) * price,
      apy: m.supplyApy,
      loanSymbol,
      collateralSymbol,
      rateType,
      lltv: m.market.lltv_wad ?? null,
    };
  });

  const funded = marketRows
    .filter((row) => toBigInt(row.allocatedAssetsRaw) > BigInt(0))
    .sort((a, b) => b.allocatedUsd - a.allocatedUsd);
  const unfunded = marketRows
    .filter((row) => toBigInt(row.allocatedAssetsRaw) === BigInt(0))
    .sort((a, b) => a.name.localeCompare(b.name));

  const idleRow = buildIdleRow({
    assetSymbol,
    assetDecimals,
    idleAssetsRaw: toBigInt(state.idle_assets),
    priceUsd: priceOf(vault.asset.address),
  });

  return { allocations: [idleRow, ...funded, ...unfunded] };
}

export async function fetchVaultV2AllocationData(
  vaultAddress: string,
  chainId: number
): Promise<VaultAllocationData & { error?: string; rateLimited?: boolean }> {
  try {
    return await loadVaultV2Allocations(vaultAddress, chainId);
  } catch (err) {
    if (isMorphoRestNotFound(err)) return { allocations: [], error: 'Vault not found' };
    if (isMorphoRestRateLimited(err)) {
      return { allocations: [], error: 'Morpho API rate limit exceeded', rateLimited: true };
    }
    logger.error(
      'Failed to fetch vault market allocations',
      err instanceof Error ? err : new Error(String(err)),
      { vaultAddress, chainId }
    );
    return { allocations: [], error: 'Failed to load market allocations' };
  }
}
