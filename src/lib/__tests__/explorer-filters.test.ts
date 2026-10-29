import { describe, expect, it } from 'vitest';
import { getDefaultExplorerFilters, parseExplorerFilters, reconcileExplorerFilters, resolveStoredExplorerFilters, assetOptionsForNetwork, curatorOptionsForNetwork, strategyOptionsForSelection } from '@/lib/explorer-filters';

describe('explorer filters', () => {
  it('opens on Base, Muscadine, and every strategy and asset', () => {
    expect(getDefaultExplorerFilters()).toMatchObject({
      network: 'base',
      curator: 'muscadine',
      strategy: 'all',
      asset: 'all',
    });
  });

  it('keeps a chosen network and turns the old untouched All default into Base', () => {
    const chosen = parseExplorerFilters(
      new URLSearchParams('network=ethereum&curator=gauntlet&strategy=all&asset=USDC&wallet=inWalletAndWhitelisted')
    );
    expect(resolveStoredExplorerFilters(chosen, true)?.network).toBe('ethereum');
    const legacy = parseExplorerFilters(
      new URLSearchParams('network=all&curator=muscadine&strategy=all&asset=all&wallet=inWalletAndWhitelisted')
    );
    expect(resolveStoredExplorerFilters(legacy, false)).toMatchObject({
      network: 'base',
      curator: 'muscadine',
    });
    expect(resolveStoredExplorerFilters(legacy, true)?.network).toBe('all');
  });

  it('limits Robinhood to Steakhouse, Frontier, and USDG', () => {
    const curators = curatorOptionsForNetwork('robinhood').map((option) => option.value);
    const assets = assetOptionsForNetwork('robinhood').map((option) => option.value);
    const strategies = strategyOptionsForSelection('robinhood', 'steakhouse-financial').map(
      (option) => option.value
    );
    expect(curators).toEqual(['steakhouse-financial']);
    expect(assets).toEqual(['all', 'USDG']);
    expect(strategies).toEqual(['all', 'frontier']);
  });

  it('offers All curators when a network has more than one, and on every network', () => {
    expect(curatorOptionsForNetwork('all').map((option) => option.value)).toEqual([
      'all',
      'muscadine',
      'gauntlet',
      'bitwise',
      'steakhouse-financial',
    ]);
    expect(curatorOptionsForNetwork('ethereum').map((option) => option.value)).toEqual([
      'all',
      'gauntlet',
      'steakhouse-financial',
    ]);
    expect(curatorOptionsForNetwork('base').map((option) => option.label)).toContain('All');
    expect(assetOptionsForNetwork('all').map((option) => option.value)).toEqual([
      'all',
      'USDC',
      'EURC',
      'cbBTC',
      'WETH',
      'USDG',
      'USDT',
    ]);
    expect(assetOptionsForNetwork('base').map((option) => option.value)).toEqual([
      'all',
      'USDC',
      'EURC',
      'cbBTC',
      'WETH',
    ]);
  });

  it('drops a curator or asset the network does not have', () => {
    const next = reconcileExplorerFilters({
      ...getDefaultExplorerFilters(),
      network: 'robinhood',
      curator: 'muscadine',
      asset: 'USDC',
      strategy: 'prime',
    });
    expect(next.curator).toBe('steakhouse-financial');
    expect(next.asset).toBe('all');
    expect(next.strategy).toBe('all');
  });

  it('keeps filters stored in the vaults URL', () => {
    const parsed = parseExplorerFilters(
      new URLSearchParams(
        'network=robinhood&curator=steakhouse-financial&strategy=frontier&asset=USDG&wallet=inWalletAndWhitelisted'
      )
    );
    expect(parsed).toMatchObject({
      network: 'robinhood',
      curator: 'steakhouse-financial',
      strategy: 'frontier',
      asset: 'USDG',
    });
  });
});
