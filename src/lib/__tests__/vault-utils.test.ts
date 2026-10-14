import { describe, expect, it } from 'vitest';
import {
  closedPairEarnedPnl,
  groupVaultFamilies,
  resolveCanUseAdvanced,
  resolvePairDefaultAddress,
  selectRegistryVaultsForExplorer,
  selectVaultKindMarkAddresses,
  findVaultByAddress,
  type WalletMorphoPosition,
} from '@/lib/vault-utils';

const MP_USDC = '0x89712980cb434ef5ae4ab29349419eb976b0b496';
const WMP_USDC = '0x036a01efddc87f6634ffde0533ee528b90fc7a45';
const MF_USDC = '0x314fd07319ef645ba7d548915ccd91f4788a1839';
const WMF_USDC = '0x54d8417bd21c86a7806b58f5aa2e2e0bb88b856a';
const MP_WETH = '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43';
const WMP_WETH = '0x548653b09b03a69f93b3890c382fe9dcd245cbc4';
const MP_CBBTC = '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70';
const WMP_CBBTC = '0x0e0a857d2af1a2d43c82d1fa54766239cab70147';

const ALL = [MP_USDC, WMP_USDC, MF_USDC, WMF_USDC, MP_WETH, WMP_WETH, MP_CBBTC, WMP_CBBTC];
const UNDERLYINGS = [MP_USDC, MF_USDC, MP_WETH, MP_CBBTC];
const WRAPPERS = [WMP_USDC, WMF_USDC, WMP_WETH, WMP_CBBTC];

const none = new Set<string>();
const listed = (opts: Parameters<typeof selectRegistryVaultsForExplorer>[0]) =>
  selectRegistryVaultsForExplorer(opts)
    .map((vault) => vault.address.toLowerCase())
    .sort();

function position(address: string, shares: string, pnlRaw?: string, pnlUsd?: number): WalletMorphoPosition {
  return { shares, pnlRaw, pnlUsd, vault: { address } };
}

describe('resolvePairDefaultAddress', () => {
  it('prefers the underlying when the wallet can deposit into it', () => {
    expect(resolvePairDefaultAddress(MP_USDC, new Set([MP_USDC, WMP_USDC]))).toBe(MP_USDC);
  });
  it('falls back to the wrapper when only the wrapper is open', () => {
    expect(resolvePairDefaultAddress(MP_USDC, new Set([WMP_USDC]))).toBe(WMP_USDC);
  });
  it('shows the underlying view-only when neither is open', () => {
    expect(resolvePairDefaultAddress(MP_USDC, none)).toBe(MP_USDC);
  });
});

describe('selectRegistryVaultsForExplorer', () => {
  it('recommended lists one contract per pair', () => {
    expect(listed({ depositedAddresses: none, eligibleVaultAddresses: new Set(ALL) })).toEqual(
      [...UNDERLYINGS].sort()
    );
    expect(listed({ depositedAddresses: none, eligibleVaultAddresses: new Set(WRAPPERS) })).toEqual(
      [...WRAPPERS].sort()
    );
  });
  it('always lists held vaults so the wallet can exit', () => {
    const result = listed({
      depositedAddresses: new Set([WMP_USDC]),
      eligibleVaultAddresses: new Set(UNDERLYINGS),
    });
    expect(result).toContain(WMP_USDC);
    expect(result).toContain(MP_USDC);
  });
  it('wrappers and all modes', () => {
    expect(
      listed({ depositedAddresses: none, eligibleVaultAddresses: none, mode: 'wrappers' })
    ).toEqual([...WRAPPERS].sort());
    expect(listed({ depositedAddresses: none, eligibleVaultAddresses: none, mode: 'all' })).toEqual(
      [...ALL].sort()
    );
  });
});

describe('resolveCanUseAdvanced', () => {
  it('is true when the wallet can deposit into both sides of a pair', () => {
    expect(resolveCanUseAdvanced(new Set([MP_USDC, WMP_USDC]), none)).toBe(true);
  });
  it('is false when the wallet can only deposit into one kind', () => {
    expect(resolveCanUseAdvanced(new Set(UNDERLYINGS), none)).toBe(false);
    expect(resolveCanUseAdvanced(new Set(WRAPPERS), none)).toBe(false);
    // Both kinds, but never both sides of the same pair.
    expect(resolveCanUseAdvanced(new Set([MP_USDC, WMP_WETH]), none)).toBe(false);
  });
  it('is true when the wallet holds a wrapper and an underlying', () => {
    expect(resolveCanUseAdvanced(none, new Set([WMP_USDC, MP_WETH]))).toBe(true);
    expect(resolveCanUseAdvanced(none, new Set([WMP_USDC, WMP_WETH]))).toBe(false);
  });
});

describe('groupVaultFamilies', () => {
  it('groups a pair under the underlying, underlying first', () => {
    const vaults = [WMP_USDC, MP_WETH, MP_USDC].map((a) => findVaultByAddress(a)!);
    const families = groupVaultFamilies(vaults);
    expect(families.map((f) => f.key)).toEqual([MP_USDC, MP_WETH]);
    expect(families[0].members.map((v) => v.address.toLowerCase())).toEqual([MP_USDC, WMP_USDC]);
  });
});

describe('selectVaultKindMarkAddresses', () => {
  it('marks only vaults whose pair is also listed', () => {
    const vaults = [MP_USDC, WMP_USDC, MP_WETH].map((a) => findVaultByAddress(a)!);
    expect([...selectVaultKindMarkAddresses(vaults)].sort()).toEqual([MP_USDC, WMP_USDC].sort());
  });
});

describe('closedPairEarnedPnl', () => {
  it('carries the closed pair profit onto the open row', () => {
    const positions = [position(MP_USDC, '10'), position(WMP_USDC, '0', '5000000', 5)];
    expect(closedPairEarnedPnl(positions, MP_USDC)).toEqual({ pnlRaw: '5000000', pnlUsd: 5 });
  });
  it('does not carry while both sides hold shares', () => {
    const positions = [position(MP_USDC, '10'), position(WMP_USDC, '1', '5000000', 5)];
    expect(closedPairEarnedPnl(positions, MP_USDC)).toBeNull();
  });
  it('ignores a loss on the closed side', () => {
    const positions = [position(MP_USDC, '10'), position(WMP_USDC, '0', '-5', -1)];
    expect(closedPairEarnedPnl(positions, MP_USDC)).toBeNull();
  });
});
