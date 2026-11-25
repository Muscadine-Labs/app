import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVaultV2Allocations } from '@/lib/vault-v2-allocations';
import { clearMorphoRestCache } from '@/lib/morpho-rest';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const VAULT = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';

const routes: Record<string, unknown> = {
  [`/v0/vaults-v2/8453:${VAULT}`]: {
    address: VAULT,
    name: 'Vault',
    asset: { address: USDC, decimals: 6, symbol: 'USDC', name: 'USD Coin' },
  },
  [`/v1/vaults-v2/8453:${VAULT}/state`]: { idle_assets: '5000000', total_assets: '0', total_supply: '0' },
  [`/v0/vaults-v2/8453:${VAULT}/allocations`]: {
    allocations: [
      {
        adapter_address: '0xadapter',
        adapter_kind: 'morpho_market_v1_v2',
        caps: [
          { cap_type: 'market_v1', market_id: '0xopen', absolute_cap: '200000000000', allocated_assets: '0', expected_supply_assets: '0' },
          { cap_type: 'market_v1', market_id: '0xfunded', absolute_cap: '1', allocated_assets: '90000000', expected_supply_assets: '100000000' },
          { cap_type: 'market_v1', market_id: '0xgone', absolute_cap: '0', allocated_assets: '0' },
        ],
      },
    ],
    unscoped_caps: [],
  },
  '/v0/blue/markets/8453:0xopen': { market_id: '0xopen', loan_token: USDC, collateral_token: WETH, irm_address: '0xother', lltv_wad: '860000000000000000' },
  '/v0/blue/markets/8453:0xfunded': { market_id: '0xfunded', loan_token: USDC, collateral_token: WETH, irm_address: '0xother', lltv_wad: '860000000000000000' },
  '/v0/blue/markets/8453:0xopen/state': { total_supply_assets: '1000000000', total_borrow_assets: '600000000', fee_wad: '0', last_accrual_timestamp: 0 },
  '/v0/blue/markets/8453:0xfunded/state': { total_supply_assets: '2000000000', total_borrow_assets: '1000000000', fee_wad: '0', last_accrual_timestamp: 0 },
  '/v0/blue/markets/8453:0xopen/apy-averages': { supply_apy_averages: { '6h': 0.03 } },
  '/v0/blue/markets/8453:0xfunded/apy-averages': { supply_apy_averages: { '6h': 0.05 } },
  [`/v0/tokens/8453:${USDC}`]: { address: USDC, decimals: 6, symbol: 'USDC' },
  [`/v0/tokens/8453:${WETH}`]: { address: WETH, decimals: 18, symbol: 'WETH' },
  [`/v0/tokens/8453:${USDC.toLowerCase()}/price`]: { price: 1 },
  [`/v0/tokens/8453:${USDC}/price`]: { price: 1 },
};

describe('loadVaultV2Allocations (Morpho REST)', () => {
  beforeEach(() => {
    clearMorphoRestCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const path = new URL(input).pathname;
        if (!(path in routes)) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify({ data: routes[path] }), { status: 200 });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists idle, funded markets by size, then capped empty markets; skips removed caps', async () => {
    const { allocations } = await loadVaultV2Allocations(VAULT, 8453);
    expect(allocations.map((row) => row.marketId ?? row.kind)).toEqual(['idle', '0xfunded', '0xopen']);
    expect(allocations[0]).toMatchObject({ kind: 'idle', allocatedAssetsRaw: '5000000', allocatedUsd: 5 });
    // The live supply (interest included) is shown, not the booked allocation.
    expect(allocations[1]).toMatchObject({
      name: 'WETH/USDC',
      allocatedAssetsRaw: '100000000',
      allocatedUsd: 100,
      marketSizeUsd: 2000,
      liquidityUsd: 1000,
      apy: 0.05,
      rateType: 'variable',
    });
    expect(allocations[2]).toMatchObject({ allocatedAssetsRaw: '0', allocatedUsd: 0, apy: 0.03 });
  });
});
