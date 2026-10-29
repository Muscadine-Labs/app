import { describe, expect, it } from 'vitest';
import {
  findVaultByAddress,
  getAllRegistryVaults,
  retiredWrapperEarnedPnl,
  type WalletMorphoPosition,
} from '@/lib/vault-utils';
import { getProductVaultAddresses, getRetiredWrapperUnderlying } from '@/lib/vaults';

const MP_USDC = '0x89712980cb434ef5ae4ab29349419eb976b0b496';
const WMP_USDC = '0x036a01efddc87f6634ffde0533ee528b90fc7a45';
const MF_USDC = '0x314fd07319ef645ba7d548915ccd91f4788a1839';
const MP_WETH = '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43';
const MP_CBBTC = '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70';

function position(address: string, shares: string, pnlRaw?: string, pnlUsd?: number): WalletMorphoPosition {
  return { shares, pnlRaw, pnlUsd, vault: { address } };
}

describe('registry', () => {
  it('lists the underlying vaults only', () => {
    expect(
      getAllRegistryVaults()
        .map((vault) => vault.address.toLowerCase())
        .sort()
    ).toEqual([MP_USDC, MF_USDC, MP_WETH, MP_CBBTC].sort());
  });
  it('has no page for a retired fee wrapper', () => {
    expect(findVaultByAddress(WMP_USDC)).toBeNull();
  });
});

describe('retired fee wrappers', () => {
  it('count toward their underlying vault', () => {
    expect(getProductVaultAddresses(MP_USDC).map((a) => a.toLowerCase())).toEqual([
      MP_USDC,
      WMP_USDC,
    ]);
    expect(getRetiredWrapperUnderlying(WMP_USDC)?.toLowerCase()).toBe(MP_USDC);
    expect(getRetiredWrapperUnderlying(MP_USDC)).toBeUndefined();
  });
});

describe('retiredWrapperEarnedPnl', () => {
  it('carries the wrapper profit onto the vault row', () => {
    const positions = [position(MP_USDC, '10'), position(WMP_USDC, '0', '5000000', 5)];
    expect(retiredWrapperEarnedPnl(positions, MP_USDC)).toEqual({ pnlRaw: '5000000', pnlUsd: 5 });
  });
  it('does not carry while the wrapper still holds shares', () => {
    const positions = [position(MP_USDC, '10'), position(WMP_USDC, '1', '5000000', 5)];
    expect(retiredWrapperEarnedPnl(positions, MP_USDC)).toBeNull();
  });
  it('ignores a loss on the wrapper', () => {
    const positions = [position(MP_USDC, '10'), position(WMP_USDC, '0', '-5', -1)];
    expect(retiredWrapperEarnedPnl(positions, MP_USDC)).toBeNull();
  });
});
