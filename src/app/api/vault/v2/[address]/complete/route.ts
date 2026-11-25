import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId, MORPHO_RATE_LIMIT_BODY } from '@/lib/api-utils';
import { BASE_CHAIN_ID, MORPHO_REST_REVALIDATE_SECONDS } from '@/lib/constants';
import { isMorphoRestNotFound, isMorphoRestRateLimited } from '@/lib/morpho-rest';
import {
  adapterTypeName,
  allRestCaps,
  getRestVault,
  getRestVaultAllocations,
  getRestVaultApy,
  getRestVaultRoleAddresses,
  getRestVaultState,
  managementFeePerYear,
  rawToNumber,
  toBigInt,
  tryGetRestTokenPriceUsd,
  wadToFraction,
  type RestAllocations,
  type RestVault,
} from '@/lib/morpho-rest-data';
import { loadMarketDetails, type MarketDetails } from '@/lib/vault-v2-markets';

type FundedMarkets = { supplied: Map<string, bigint>; markets: MarketDetails[] } | null;

/** The vault's live supply per funded Blue market, with each market's state. `null` on failure. */
async function loadFundedMarkets(chainId: number, vaultAddress: string, allocations: RestAllocations): Promise<FundedMarkets> {
  const supplied = new Map<string, bigint>();
  for (const cap of allRestCaps(allocations)) {
    if (cap.cap_type !== 'market_v1' || !cap.market_id) continue;
    const amount = toBigInt(cap.expected_supply_assets ?? cap.allocated_assets);
    if (amount <= BigInt(0)) continue;
    const id = cap.market_id.toLowerCase();
    supplied.set(id, (supplied.get(id) ?? BigInt(0)) + amount);
  }
  try {
    return { supplied, markets: await loadMarketDetails(chainId, [...supplied.keys()]) };
  } catch (error) {
    logger.warn('Vault market states unavailable', {
      vaultAddress,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * What force deallocation could pull out beyond instant liquidity: for each funded market
 * except the liquidity route (already counted as instant), the lesser of the vault's supply and
 * the market's cash. GraphQL had this as `forceDeallocatableLiquidity`; REST does not.
 * Unknown market states count as 0 (shown as less liquidity, never more).
 */
function forceDeallocatableLiquidity(vault: RestVault, funded: FundedMarkets): bigint {
  if (!funded) return BigInt(0);
  const routeMarket = vault.liquidity_data?.toLowerCase();
  return funded.markets.reduce((sum, m) => {
    if (m.marketId === routeMarket) return sum;
    const cash = toBigInt(m.state.total_supply_assets) - toBigInt(m.state.total_borrow_assets);
    const mine = funded.supplied.get(m.marketId) ?? BigInt(0);
    return sum + (cash <= BigInt(0) ? BigInt(0) : cash < mine ? cash : mine);
  }, BigInt(0));
}

/**
 * Instant gross APY, the way Morpho's `netApy` was built: each funded market's current supply
 * APY weighted by the vault's supply there, over total assets (idle earns nothing). `null` when
 * a market's APY or the totals are unknown.
 */
function instantGrossApy(funded: FundedMarkets, totalAssets: bigint): number | null {
  if (!funded || totalAssets <= BigInt(0)) return null;
  let weighted = 0;
  for (const m of funded.markets) {
    if (m.supplyApy === null) return null;
    weighted += Number(funded.supplied.get(m.marketId) ?? BigInt(0)) * m.supplyApy;
  }
  const apy = weighted / Number(totalAssets);
  return Number.isFinite(apy) ? apy : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || String(BASE_CHAIN_ID);
  
  let address: string | undefined;
  try {
    const resolvedParams = await params;
    address = resolvedParams.address;

    // Validate inputs
    if (!isValidEthereumAddress(address)) {
      return NextResponse.json(
        { error: 'Invalid vault address format' },
        { status: 400 }
      );
    }

    if (!isValidChainId(chainIdParam)) {
      return NextResponse.json(
        { error: 'Invalid chain ID' },
        { status: 400 }
      );
    }

    const chainId = parseInt(chainIdParam, 10);

    let vault: RestVault;
    let state: Awaited<ReturnType<typeof getRestVaultState>>;
    let allocations: Awaited<ReturnType<typeof getRestVaultAllocations>>;
    let sentinels: string[];
    let allocators: string[];
    try {
      [vault, state, allocations, sentinels, allocators] = await Promise.all([
        getRestVault(chainId, address),
        getRestVaultState(chainId, address),
        getRestVaultAllocations(chainId, address),
        getRestVaultRoleAddresses(chainId, address, 'sentinels'),
        getRestVaultRoleAddresses(chainId, address, 'allocators'),
      ]);
    } catch (error) {
      if (isMorphoRestRateLimited(error)) {
        return NextResponse.json(MORPHO_RATE_LIMIT_BODY, { status: 503 });
      }
      if (isMorphoRestNotFound(error)) {
        return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
      }
      throw error;
    }

    const assetDecimals = vault.asset.decimals ?? 18;
    const price = (await tryGetRestTokenPriceUsd(chainId, vault.asset.address)) ?? 0;
    const usd = (raw: bigint) => rawToNumber(raw, assetDecimals) * price;

    const totalAssetsRaw = toBigInt(state.total_assets);
    const totalSupplyRaw = toBigInt(state.total_supply);
    const instantLiquidityRaw = toBigInt(state.withdrawable_assets);
    const idleLiquidityRaw = toBigInt(state.idle_assets);
    const funded = await loadFundedMarkets(chainId, address, allocations);
    const deallocatableLiquidityRaw = forceDeallocatableLiquidity(vault, funded);

    const totalAssetsUsd = usd(totalAssetsRaw);
    const totalSupplyDecimal = Number(totalSupplyRaw) / 1e18;
    const sharePrice = state.share_price_ray ? Number(toBigInt(state.share_price_ray) / BigInt(1e9)) / 1e18 : 0;
    const sharePriceUsd = totalSupplyDecimal > 0 ? sharePrice * price : 0;

    const performanceFee = wadToFraction(vault.performance_fee_wad) ?? 0;
    const managementFee = managementFeePerYear(vault.management_fee_wad);
    // REST has no instant vault APY: compute it from the markets (fees after), else Morpho's
    // 6h average (already net). Rewards are excluded either way (not in REST).
    const gross = instantGrossApy(funded, totalAssetsRaw);
    const averageNet =
      gross === null ? await getRestVaultApy(chainId, address, 'six_hours').catch(() => null) : null;
    const headlineApy = gross !== null ? gross * (1 - performanceFee) - managementFee : averageNet ?? 0;
    const grossApy =
      gross ?? (performanceFee < 1 ? (headlineApy + managementFee) / (1 - performanceFee) : headlineApy);

    const liquidityAdapterRaw =
      instantLiquidityRaw > idleLiquidityRaw ? instantLiquidityRaw - idleLiquidityRaw : BigInt(0);
    const liquidityAdapterKind = (allocations.allocations ?? []).find(
      (a) => a?.adapter_address?.toLowerCase() === vault.liquidity_adapter?.toLowerCase()
    )?.adapter_kind;

    const timelocks = (vault.governance?.timelocks ?? [])
      .filter((entry) => !!entry?.function_name)
      .map((entry) => ({
        functionName: entry.function_name,
        duration: Number(entry.timelock_seconds ?? 0),
        abdicated: entry.is_abdicated === true,
      }));

    const vaultByAddress = {
      address: vault.address,
      name: vault.name,
      symbol: vault.symbol,
      asset: {
        address: vault.asset.address,
        symbol: vault.asset.symbol,
        decimals: assetDecimals,
        name: vault.asset.name,
        price: { usd: price || null },
      },
      totalAssets: totalAssetsRaw.toString(),
      totalAssetsUsd,
      totalSupply: totalSupplyRaw.toString(),
      liquidity: instantLiquidityRaw.toString(),
      liquidityUsd: usd(instantLiquidityRaw),
      idleAssets: idleLiquidityRaw.toString(),
      idleAssetsUsd: usd(idleLiquidityRaw),
      liquidityBreakdown: {
        instantLiquidityAssets: instantLiquidityRaw.toString(),
        instantLiquidityUsd: usd(instantLiquidityRaw),
        idleLiquidityAssets: idleLiquidityRaw.toString(),
        idleLiquidityUsd: usd(idleLiquidityRaw),
        liquidityAdapterAssets: liquidityAdapterRaw.toString(),
        liquidityAdapterUsd: usd(liquidityAdapterRaw),
        deallocatableLiquidityAssets: deallocatableLiquidityRaw.toString(),
        deallocatableLiquidityUsd: usd(deallocatableLiquidityRaw),
        totalUnderlyingLiquidityAssets: (instantLiquidityRaw + deallocatableLiquidityRaw).toString(),
        totalUnderlyingLiquidityUsd: usd(instantLiquidityRaw + deallocatableLiquidityRaw),
      },
      performanceFee,
      managementFee,
      allocators: allocators.map((a) => ({ address: a })),
      sentinels,
      timelocks,
      maxRate: vault.max_rate_per_second_wad ?? null,
      liquidityAdapterAddress: vault.liquidity_adapter ?? null,
      liquidityAdapterType: adapterTypeName(liquidityAdapterKind),
      state: {
        totalAssets: totalAssetsRaw.toString(),
        totalAssetsUsd,
        totalSupply: totalSupplyRaw.toString(),
        sharePrice,
        sharePriceUsd,
        apy: headlineApy,
        grossApy,
        netApy: headlineApy,
        // Rewards are not in REST (Merkl has its own API); no registry vault has any.
        netApyWithoutRewards: headlineApy,
        avgApy: headlineApy,
        avgNetApy: headlineApy,
        maxApy: 0,
        owner: vault.owner ?? '',
        curator: vault.curator ?? '',
        guardian: '',
        timelock: 0,
        fee: performanceFee,
        allocation: [],
        rewards: [],
      },
    };
    const data = { data: { vaultByAddress } };

    return NextResponse.json({
      ...data,
      cached: false,
      timestamp: Date.now(),
    }, {
      headers: {
        'Cache-Control': `public, s-maxage=${MORPHO_REST_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_REST_REVALIDATE_SECONDS * 2}`,
      }
    });

  } catch (error) {
    logger.error(
      'Failed to fetch complete vault data',
      error instanceof Error ? error : new Error(String(error)),
      { address: address ?? 'unknown', chainId: chainIdParam }
    );

    return NextResponse.json(
      { 
        error: 'Failed to fetch complete vault data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}


