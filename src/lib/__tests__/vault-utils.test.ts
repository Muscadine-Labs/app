import { describe, expect, it } from 'vitest';
import {
  findVaultByAddress,
  getAllRegistryVaults,
  isRetiredFeeWrapperAddress,
  preferredVaultName,
  sortVaultsForDisplay,
  vaultAddressPlaceholderName,
} from '@/lib/vault-utils';
import type { Vault } from '@/types/vault';

const MP_USDC = '0x89712980cb434ef5ae4ab29349419eb976b0b496';
const RETIRED_WRAPPER = '0x036a01efddc87f6634ffde0533ee528b90fc7a45';
const MF_USDC = '0x314fd07319ef645ba7d548915ccd91f4788a1839';
const MP_WETH = '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43';
const MP_CBBTC = '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70';

describe('registry', () => {
  it('lists the underlying vaults only', () => {
    expect(
      getAllRegistryVaults()
        .map((vault) => vault.address.toLowerCase())
        .sort()
    ).toEqual([MP_USDC, MF_USDC, MP_WETH, MP_CBBTC].sort());
  });
  it('does not list a retired fee wrapper', () => {
    expect(findVaultByAddress(RETIRED_WRAPPER)).toBeNull();
    expect(isRetiredFeeWrapperAddress(RETIRED_WRAPPER)).toBe(true);
    expect(isRetiredFeeWrapperAddress(MP_USDC)).toBe(false);
  });
});

describe('preferredVaultName', () => {
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  it('prefers the Morpho name', () => {
    expect(preferredVaultName('Morpho Name', 'Positions Name', address)).toBe('Morpho Name');
  });
  it('lets a real fallback beat the address placeholder', () => {
    expect(preferredVaultName(vaultAddressPlaceholderName(address), 'Positions Name', address)).toBe('Positions Name');
    expect(preferredVaultName('  ', 'Positions Name', address)).toBe('Positions Name');
  });
  it('uses the placeholder only when nothing else has a name', () => {
    expect(preferredVaultName(undefined, '', address)).toBe(vaultAddressPlaceholderName(address));
  });
});

describe('sortVaultsForDisplay', () => {
  // Morpho has no name for some external vaults; one in the list used to crash the dashboard.
  it('does not throw when a vault has no name', () => {
    const named = { address: MP_USDC, name: 'USDC Prime', symbol: 'USDC', chainId: 8453 } as Vault;
    const nameless = { address: MF_USDC, symbol: 'USDC', chainId: 8453 } as unknown as Vault;
    const sorted = sortVaultsForDisplay([named, nameless], [], () => 0);
    expect(sorted.map((v) => v.address)).toEqual([MF_USDC, MP_USDC]);
  });
});

describe('preferredVaultName for an unnamed external vault', () => {
  it('falls back to the address placeholder', () => {
    const address = '0x6694eAE513FEb17b2483b2f73FA9eA826CF1f5dF';
    expect(preferredVaultName('', undefined, address)).toBe(vaultAddressPlaceholderName(address));
  });
});
