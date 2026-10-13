import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultVersion = 'v2';

/** Product strategy — Prime (default) or Frontier. */
export type VaultStrategy = 'prime' | 'frontier';

export interface VaultDefinition {
  address: string;
  name: string;
  /** Underlying asset symbol (USDC, cbBTC, WETH). */
  symbol: string;
  /** Share token label (e.g. mpUSDC, mfUSDC). */
  vaultSymbol: string;
  chainId: number;
  version: VaultVersion;
  strategy: VaultStrategy;
}

const BASE = BASE_CHAIN_ID;

const USDC_PRIME = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const USDC_FRONTIER = '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const WETH_PRIME = '0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43';
const CBBTC_PRIME = '0x99dcd0D75822BA398F13B2A8852B07c7e137EC70';

export const VAULTS: Record<string, VaultDefinition> = {
  USDC_VAULT_V2: {
    address: USDC_PRIME,
    name: 'Muscadine USDC Prime',
    symbol: 'USDC',
    vaultSymbol: 'mpUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
  },
  cbBTC_VAULT_V2: {
    address: CBBTC_PRIME,
    name: 'Muscadine cbBTC Prime',
    symbol: 'cbBTC',
    vaultSymbol: 'mpcbBTC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
  },
  WETH_VAULT_V2: {
    address: WETH_PRIME,
    name: 'Muscadine WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'mpWETH',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
  },
  USDC_FRONTIER_VAULT_V2: {
    address: USDC_FRONTIER,
    name: 'Muscadine USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'mfUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'frontier',
  },
};

export function getRegistryVaultList(): VaultDefinition[] {
  return Object.values(VAULTS);
}

/**
 * Retired fee wrappers and the registry vault each deposited into. Depositors have migrated;
 * these are not vaults in the app. They are kept only so a migrated depositor's chart and
 * earned interest on the underlying vault include the wrapper period.
 */
export const RETIRED_WRAPPERS: ReadonlyArray<{
  address: string;
  vaultSymbol: string;
  underlyingAddress: string;
}> = [
  { address: '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45', vaultSymbol: 'wmpUSDC', underlyingAddress: USDC_PRIME },
  { address: '0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A', vaultSymbol: 'wmfUSDC', underlyingAddress: USDC_FRONTIER },
  { address: '0x548653b09b03A69f93B3890c382fE9DcD245cbc4', vaultSymbol: 'wmpWETH', underlyingAddress: WETH_PRIME },
  { address: '0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147', vaultSymbol: 'wmpcbBTC', underlyingAddress: CBBTC_PRIME },
];

/** True for a retired wrapper. These never get a row of their own in the UI. */
export function isRetiredWrapperAddress(address: string): boolean {
  const key = address.toLowerCase();
  return RETIRED_WRAPPERS.some((wrapper) => wrapper.address.toLowerCase() === key);
}

/** Retired wrapper that deposited into this registry vault, if any. */
export function findRetiredWrapperFor(underlyingAddress: string) {
  const key = underlyingAddress.toLowerCase();
  return RETIRED_WRAPPERS.find((wrapper) => wrapper.underlyingAddress.toLowerCase() === key);
}

/** The other contract of a registry vault / retired wrapper pair, if there is one. */
export function getPairedVaultAddress(address: string): string | undefined {
  const key = address.toLowerCase();
  const wrapper = RETIRED_WRAPPERS.find((item) => item.address.toLowerCase() === key);
  if (wrapper) return wrapper.underlyingAddress;
  return findRetiredWrapperFor(address)?.address;
}

/** A registry vault plus its retired wrapper: the addresses whose history counts as one position. */
export function getProductVaultAddresses(address: string): string[] {
  const wrapper = findRetiredWrapperFor(address);
  return wrapper ? [address, wrapper.address] : [address];
}
