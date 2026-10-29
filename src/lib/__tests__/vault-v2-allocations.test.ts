import { describe, expect, it } from 'vitest';
import { parseVaultV2AllocationsFromGraphQL } from '@/lib/vault-v2-allocations';

describe('parseVaultV2AllocationsFromGraphQL', () => {
  it('shows a wrapper deposit into its underlying vault as a vault row', () => {
    const { allocations } = parseVaultV2AllocationsFromGraphQL(
      {
        idleAssets: 0,
        idleAssetsUsd: 0,
        asset: { symbol: 'USDC', decimals: 6 },
        adapters: {
          items: [
            {
              __typename: 'MorphoVaultV2Adapter',
              assets: 1004704,
              assetsUsd: 1.0045,
              innerVault: {
                address: '0x89712980Cb434eF5aE4AB29349419eb976B0b496',
                name: 'Muscadine USDC Prime',
                netApy: 0.047,
                liquidityUsd: 118261.7,
                totalAssetsUsd: 131401.9,
              },
            },
          ],
        },
      },
      8453
    );
    expect(allocations.map((row) => row.kind)).toEqual(['idle', 'vault']);
    expect(allocations[0]).toMatchObject({ kind: 'idle', name: 'USDC (Idle)', apy: 0, allocatedUsd: 0, liquidityUsd: 0 });
    expect(allocations[1]).toMatchObject({
      kind: 'vault',
      name: 'Muscadine USDC Prime',
      vaultAddress: '0x89712980Cb434eF5aE4AB29349419eb976B0b496',
      allocatedAssetsRaw: '1004704',
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      apy: 0.047,
      liquidityUsd: 118261.7,
      marketSizeUsd: 131401.9,
    });
  });

  it('skips an empty vault adapter and keeps idle', () => {
    const { allocations } = parseVaultV2AllocationsFromGraphQL(
      {
        idleAssets: '500',
        idleAssetsUsd: 0.0005,
        asset: { symbol: 'USDC', decimals: 6 },
        adapters: {
          items: [
            {
              __typename: 'MorphoVaultV2Adapter',
              assets: 0,
              assetsUsd: 0,
              innerVault: { address: '0x89712980Cb434eF5aE4AB29349419eb976B0b496', name: 'x' },
            },
          ],
        },
      },
      8453
    );
    expect(allocations.map((row) => row.kind)).toEqual(['idle']);
  });

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
