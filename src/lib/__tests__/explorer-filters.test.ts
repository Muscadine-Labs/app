import { describe, expect, it } from 'vitest';
import {
  getDefaultExplorerFilters,
  parseExplorerFilters,
  reconcileExplorerFilters,
  assetOptionsForNetwork,
  networkOptions,
  strategyFromVaultName,
  strategyOptionsForNetwork,
} from '@/lib/explorer-filters';

describe('explorer filters', () => {
  it('opens on Base, every strategy, and every asset', () => {
    expect(getDefaultExplorerFilters()).toEqual({
      network: 'base',
      strategy: 'all',
      asset: 'all',
      walletFilter: 'inWalletAndWhitelisted',
    });
  });

  it('lists only Base, because Muscadine vaults are on Base', () => {
    expect(networkOptions().map((option) => option.value)).toEqual(['base']);
    expect(assetOptionsForNetwork('base').map((option) => option.value)).toEqual([
      'all',
      'USDC',
      'cbBTC',
      'WETH',
    ]);
    expect(strategyOptionsForNetwork('base').map((option) => option.value)).toEqual([
      'all',
      'prime',
      'frontier',
    ]);
  });

  it('drops a network or asset Muscadine does not have', () => {
    const parsed = parseExplorerFilters(
      new URLSearchParams('network=ethereum&strategy=prime&asset=USDC&wallet=inWalletAndWhitelisted')
    );
    expect(parsed).toEqual({
      network: 'base',
      strategy: 'prime',
      asset: 'USDC',
      walletFilter: 'inWalletAndWhitelisted',
    });
    expect(reconcileExplorerFilters({
      ...getDefaultExplorerFilters(),
      asset: 'USDC',
      strategy: 'prime',
    })).toMatchObject({ network: 'base', asset: 'USDC', strategy: 'prime' });
  });

  it('keeps a strategy and asset stored in the vaults URL and ignores a curator param', () => {
    const parsed = parseExplorerFilters(
      new URLSearchParams(
        'network=base&curator=gauntlet&strategy=frontier&asset=USDC&wallet=inWalletAndWhitelisted'
      )
    );
    expect(parsed).toEqual({
      network: 'base',
      strategy: 'frontier',
      asset: 'USDC',
      walletFilter: 'inWalletAndWhitelisted',
    });
  });

  it('reads Prime and Frontier from a vault name', () => {
    expect(strategyFromVaultName('Muscadine USDC Prime')).toBe('prime');
    expect(strategyFromVaultName('Muscadine USDC Frontier')).toBe('frontier');
    expect(strategyFromVaultName('Muscadine High Yield USDC')).toBeUndefined();
  });
});
