import { describe, expect, it } from 'vitest';
import { mapVaultV2Caps } from '@/lib/vault-v2-caps';

const WAD = '1000000000000000000';
const UINT128_MAX = '340282366920938463463374607431768211455';

describe('mapVaultV2Caps', () => {
  it('labels market, collateral and adapter caps and drops removed ones', () => {
    const data = mapVaultV2Caps({
      asset: { symbol: 'USDC', decimals: 6 },
      adapters: {
        items: [{ __typename: 'MorphoMarketV1Adapter', address: '0xAdApTeR0000000000000000000000000000000001' }],
      },
      caps: {
        items: [
          {
            type: 'Collateral',
            absoluteCap: 250000000000,
            relativeCap: WAD,
            allocation: 16881471146,
            data: { __typename: 'CollateralCapData', collateralAddress: '0xcb585250f852C6c6bf90434AB21A00f02833a4af' },
          },
          {
            type: 'MarketV1',
            absoluteCap: 200000000000,
            relativeCap: WAD,
            allocation: 16881471146,
            data: {
              __typename: 'MarketV1CapData',
              market: {
                marketId: '0xd4a9',
                lltv: '625000000000000000',
                loanAsset: { symbol: 'USDC' },
                collateralAsset: { address: '0xCB585250F852C6C6BF90434AB21A00F02833A4AF', symbol: 'cbXRP' },
              },
            },
          },
          {
            type: 'MarketV1',
            absoluteCap: 0,
            relativeCap: WAD,
            allocation: 0,
            data: {
              __typename: 'MarketV1CapData',
              market: {
                marketId: '0xdead',
                lltv: '860000000000000000',
                loanAsset: { symbol: 'USDC' },
                collateralAsset: { address: '0x1', symbol: 'OLD' },
              },
            },
          },
          {
            type: 'Adapter',
            absoluteCap: UINT128_MAX,
            relativeCap: WAD,
            allocation: 24958000000,
            data: { __typename: 'AdapterCapData', adapterAddress: '0xadapter0000000000000000000000000000000001' },
          },
        ],
      },
    });

    expect(data.assetSymbol).toBe('USDC');
    expect(data.assetDecimals).toBe(6);
    expect(data.caps.map((row) => [row.kind, row.label])).toEqual([
      ['market', 'cbXRP / USDC'],
      ['collateral', 'cbXRP'],
      ['adapter', 'Morpho Blue adapter'],
    ]);
    expect(data.caps[0].href).toBe(
      'https://app.morpho.org/base/variable/0xd4a9/cbxrp-usdc#market'
    );
    expect(data.caps[1].href).toBe(
      'https://basescan.org/token/0xcb585250f852C6c6bf90434AB21A00f02833a4af'
    );
    expect(data.caps[2].href).toBeNull();
    expect(data.caps[0].lltv).toBe(0.625);
    expect(data.caps[0].rateType).toBe('variable');
    expect(data.caps[0].absoluteCapRaw).toBe('200000000000');
    expect(data.caps[2].absoluteCapRaw).toBe(UINT128_MAX);
  });

  it('links a fixed-rate market cap to the fixed market page', () => {
    const data = mapVaultV2Caps({
      asset: { symbol: 'USDC', decimals: 6 },
      caps: {
        items: [
          {
            type: 'MarketV1Fixed',
            absoluteCap: 200000000000,
            relativeCap: WAD,
            allocation: 1,
            data: {
              __typename: 'MarketV1CapData',
              market: {
                marketId: '0xfixed',
                lltv: '625000000000000000',
                loanAsset: { symbol: 'USDC' },
                collateralAsset: { symbol: 'cbBTC' },
              },
            },
          },
        ],
      },
    });

    expect(data.caps[0].rateType).toBe('fixed');
    expect(data.caps[0].href).toBe(
      'https://markets.morpho.org/fixed/base/0xfixed'
    );
  });

  it('names a wrapper adapter after its underlying vault', () => {
    const data = mapVaultV2Caps({
      asset: { symbol: 'USDC', decimals: 6 },
      adapters: {
        items: [
          {
            __typename: 'MorphoVaultV2Adapter',
            address: '0x5b211DA4Cd92cfb9CCCFbd1De78289955EB236CD',
            innerVault: { name: 'Muscadine USDC Frontier' },
          },
        ],
      },
      caps: {
        items: [
          {
            type: 'Adapter',
            absoluteCap: UINT128_MAX,
            relativeCap: WAD,
            allocation: 1007832,
            data: { __typename: 'AdapterCapData', adapterAddress: '0x5b211da4cd92cfb9cccfbd1de78289955eb236cd' },
          },
        ],
      },
    });
    expect(data.caps).toHaveLength(1);
    expect(data.caps[0].label).toBe('Muscadine USDC Frontier');
    expect(data.caps[0].allocationRaw).toBe('1007832');
  });
});
