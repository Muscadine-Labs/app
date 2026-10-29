import { describe, expect, it } from 'vitest';
import { BASE_CHAIN_ID, ETHEREUM_CHAIN_ID, ROBINHOOD_CHAIN_ID } from '@/lib/constants';
import { getAllPartnerVaults, getPartnerVaults, isListedAssetSymbol, isPartnerVaultAddress } from '@/lib/partner-vaults';
import { isOpenableVaultAddress, resolveVaultForPage } from '@/lib/vault-utils';

const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ETH_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

describe('partner vaults', () => {
  it('lists the Steakhouse vaults on Base', () => {
    const vaults = getPartnerVaults('steakhouse-financial').filter(
      (vault) => vault.chainId === BASE_CHAIN_ID
    );
    expect(vaults.map((vault) => vault.name)).toEqual([
      'Grove x Steakhouse USDC',
      'Steakhouse Prime USDC',
      'Steakhouse High Yield USDC',
      'Steakhouse Prime EURC',
      'Steakhouse Prime ETH',
    ]);
    expect(vaults.every((vault) => vault.assetAddress?.toLowerCase() === BASE_USDC || vault.symbol !== 'USDC')).toBe(true);
    expect(vaults.find((vault) => vault.symbol === 'EURC')?.assetAddress).toBe(
      '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'
    );
  });

  it('lists the Ethereum Steakhouse vaults without Confidential, including Grove USDC', () => {
    const vaults = getPartnerVaults('steakhouse-financial').filter(
      (vault) => vault.chainId === ETHEREUM_CHAIN_ID
    );
    const names = vaults.map((vault) => vault.name);
    expect(names).toContain('Steakhouse Prime USDC');
    expect(names).toContain('Steakhouse Prime USDT');
    expect(names).toContain('Steakhouse High Yield USDC');
    expect(names).toContain('Steakhouse Prime ETH');
    expect(names).toContain('Steakhouse High Yield USDT');
    expect(names).toContain('Steakhouse Prime EURC');
    expect(names).toContain('Grove x Steakhouse USDC');
    expect(names.some((name) => name.includes('Confidential'))).toBe(false);
    expect(vaults.find((vault) => vault.name === 'Grove x Steakhouse USDC')?.assetAddress?.toLowerCase()).toBe(ETH_USDC);
  });

  it('lists one Steakhouse vault on Robinhood', () => {
    const vaults = getPartnerVaults('steakhouse-financial').filter(
      (vault) => vault.chainId === ROBINHOOD_CHAIN_ID
    );
    expect(vaults).toHaveLength(1);
    expect(vaults[0]?.name).toBe('Steakhouse USDG');
    expect(vaults[0]?.strategy).toBe('frontier');
    expect(vaults[0]?.assetAddress).toBe('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
  });

  it('opens Gauntlet and Steakhouse vaults with a pinned asset address', () => {
    const gauntlet = getPartnerVaults('gauntlet');
    expect(gauntlet.length).toBeGreaterThan(0);
    expect(gauntlet.every((vault) => vault.assetAddress && vault.isCurated === false)).toBe(true);
    expect(gauntlet.some((vault) => vault.symbol === 'MXNB' || vault.name.includes('Juno'))).toBe(false);
    expect(gauntlet.some((vault) => vault.address.toLowerCase() === '0x39e18c066187c83e860801befe45ae8ecd021575')).toBe(false);
    expect(getAllPartnerVaults().every((vault) => isListedAssetSymbol(vault.symbol))).toBe(true);
    expect(isPartnerVaultAddress('0x39E18c066187c83e860801Befe45aE8ecd021575')).toBe(false);
    const bitwise = getPartnerVaults('bitwise');
    expect(bitwise).toHaveLength(1);
    expect(bitwise[0]?.name).toBe('Bitwise Liquid Prime USDC');
    expect(bitwise[0]?.chainId).toBe(BASE_CHAIN_ID);
    expect(bitwise[0]?.assetAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(resolveVaultForPage(bitwise[0]!.address)?.symbol).toBe('USDC');
    const sample = gauntlet[0]!;
    expect(isPartnerVaultAddress(sample.address)).toBe(true);
    expect(isOpenableVaultAddress(sample.address)).toBe(true);
    expect(resolveVaultForPage(sample.address)?.assetAddress).toBe(sample.assetAddress);
  });
});
