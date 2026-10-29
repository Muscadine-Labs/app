import { describe, expect, it } from 'vitest';
import { parseVaultV2AllocationsFromGraphQL } from '@/lib/vault-v2-allocations';

describe('parseVaultV2AllocationsFromGraphQL', () => {
  it('keeps a capped market with nothing allocated, and skips a removed cap', () => {
    const { allocations } = parseVaultV2AllocationsFromGraphQL(
      {
        idleAssets: 0,
        idleAssetsUsd: 0,
        asset: { symbol: 'USDC', decimals: 6 },
        adapters: { items: [] },
        caps: {
          items: [
            {
              type: 'MarketV1',
              absoluteCap: '200000000000',
              allocation: 0,
              data: {
                market: {
                  marketId: '0xopen',
                  lltv: '860000000000000000',
                  loanAsset: { symbol: 'USDC', decimals: 6 },
                  collateralAsset: { symbol: 'WETH' },
                  state: { supplyAssetsUsd: 1000, liquidityAssetsUsd: 400, netSupplyApy: 0.03 },
                },
              },
            },
            {
              type: 'MarketV1',
              absoluteCap: 0,
              allocation: 0,
              data: {
                market: {
                  marketId: '0xgone',
                  loanAsset: { symbol: 'USDC' },
                  collateralAsset: { symbol: 'OLD' },
                },
              },
            },
          ],
        },
      },
      8453
    );
    expect(allocations.map((row) => row.kind)).toEqual(['idle', 'market']);
    expect(allocations[1]).toMatchObject({
      kind: 'market',
      marketId: '0xopen',
      name: 'WETH/USDC',
      allocatedUsd: 0,
      allocatedAssetsRaw: '0',
      apy: 0.03,
      rateType: 'variable',
    });
  });
});
