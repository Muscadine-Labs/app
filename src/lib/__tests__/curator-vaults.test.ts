import { describe, expect, it } from 'vitest';
import {
  curatorVaultCandidates,
  explorerCuratorAddresses,
  strategyFromVaultName,
  toCuratorExplorerVaults,
  type ListedVaultV2,
} from '@/lib/curator-vaults';

const GAUNTLET = '0x1111111111111111111111111111111111111111';
const STEAK = '0x2222222222222222222222222222222222222222';

const BASE = { id: 8453 };
const ETHEREUM = { id: 1 };

const ITEMS: ListedVaultV2[] = [
  {
    address: GAUNTLET,
    name: 'Gauntlet USDC Prime',
    symbol: 'gtUSDC',
    totalAssetsUsd: 10,
    chain: BASE,
    asset: { symbol: 'USDC' },
    curators: { items: [{ id: 'gauntlet', name: 'Gauntlet' }] },
  },
  {
    address: STEAK,
    name: 'Steakhouse Prime USDC',
    symbol: 'steakUSDC',
    totalAssetsUsd: 50,
    chain: BASE,
    asset: { symbol: 'USDC' },
    curators: { items: [{ id: 'steakhouse-financial', name: 'Steakhouse Financial' }] },
  },
  {
    address: 'not-an-address',
    name: 'Ignored',
    chain: BASE,
    curators: { items: [{ id: 'gauntlet', name: 'Gauntlet' }] },
  },
  {
    address: GAUNTLET,
    name: 'Other chain',
    chain: { id: 42161 },
    curators: { items: [{ id: 'gauntlet', name: 'Gauntlet' }] },
  },
];

describe('toCuratorExplorerVaults', () => {
  it('keeps listed vaults for the selected curator', () => {
    const vaults = toCuratorExplorerVaults(ITEMS, 'gauntlet');
    expect(vaults).toHaveLength(1);
    expect(vaults[0]).toMatchObject({
      address: GAUNTLET,
      name: 'Gauntlet USDC Prime',
      symbol: 'USDC',
      vaultSymbol: 'gtUSDC',
      curator: 'Gauntlet',
      strategy: 'prime',
      version: 'v2',
      chainId: 8453,
      isCurated: false,
      totalValueLocked: 10,
    });
  });

  it('keeps the same address on another explorer chain', () => {
    const ethereum: ListedVaultV2 = {
      ...ITEMS[0],
      chain: ETHEREUM,
      totalAssetsUsd: 20,
    };
    const vaults = toCuratorExplorerVaults([ITEMS[0], ethereum], 'gauntlet');
    expect(vaults.map((vault) => vault.chainId).sort()).toEqual([1, 8453]);
  });

  it('drops fee wrappers', () => {
    const wrapper: ListedVaultV2 = {
      address: GAUNTLET,
      name: 'Gauntlet USDC Prime Wrapper',
      type: 'FeeWrapper',
      curators: { items: [{ id: 'gauntlet', name: 'Gauntlet' }] },
    };
    expect(toCuratorExplorerVaults([wrapper], 'gauntlet')).toHaveLength(0);
  });

  it('sorts the curator catalog by deposits', () => {
    const items: ListedVaultV2[] = [
      {
        address: GAUNTLET,
        name: 'Small',
        totalAssetsUsd: 1,
        chain: BASE,
        asset: { symbol: 'WETH' },
        curators: { items: [{ id: 'steakhouse-financial', name: 'Steakhouse Financial' }] },
      },
      {
        address: STEAK,
        name: 'Large',
        totalAssetsUsd: 9,
        chain: BASE,
        asset: { symbol: 'USDC' },
        curators: { items: [{ id: 'steakhouse-financial', name: 'Steakhouse Financial' }] },
      },
    ];
    expect(toCuratorExplorerVaults(items, 'steakhouse-financial').map((vault) => vault.name)).toEqual([
      'Large',
      'Small',
    ]);
  });
});

describe('explorerCuratorAddresses', () => {
  it('keeps verified curator addresses on explorer chains only', () => {
    expect(
      explorerCuratorAddresses([
        { address: GAUNTLET, chainId: 8453 },
        { address: GAUNTLET, chainId: 1 },
        { address: STEAK, chainId: 4663 },
        { address: STEAK, chainId: 42161 },
        { address: 'nope', chainId: 1 },
      ])
    ).toEqual([GAUNTLET, STEAK]);
  });
});

describe('strategyFromVaultName', () => {
  it('reads Prime and Frontier from the vault name', () => {
    expect(strategyFromVaultName('Gauntlet USDC Prime')).toBe('prime');
    expect(strategyFromVaultName('Gauntlet USDC Frontier')).toBe('frontier');
    expect(strategyFromVaultName('Gauntlet EURC Balanced')).toBeUndefined();
    expect(strategyFromVaultName('Steakhouse High Yield USDC')).toBeUndefined();
  });
});

describe('curatorVaultCandidates', () => {
  const vaults = toCuratorExplorerVaults(ITEMS, 'gauntlet');

  it('returns the catalog unless the wallet filter is deposits only', () => {
    expect(curatorVaultCandidates(vaults, [], 'all')).toEqual(vaults);
    expect(curatorVaultCandidates(vaults, [], 'inWalletAndWhitelisted')).toEqual(vaults);
  });

  it('keeps only vaults the wallet holds', () => {
    expect(
      curatorVaultCandidates(vaults, [{ shares: '1', vault: { address: GAUNTLET } }], 'inWallet')
    ).toHaveLength(1);
    expect(curatorVaultCandidates(vaults, [], 'inWallet')).toHaveLength(0);
  });
});
