import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultVersion = 'v2';

/** Product strategy — Prime (default) or Frontier. */
export type VaultStrategy = 'prime' | 'frontier';

export interface VaultDefinition {
  address: string;
  name: string;
  /** Underlying asset symbol (USDC, cbBTC, WETH). */
  symbol: string;
  /** Share token label (e.g. mpUSDC). */
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

const USDC_PRIME_WRAPPER = '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45';
const USDC_FRONTIER_WRAPPER = '0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A';
const WETH_PRIME_WRAPPER = '0x548653b09b03A69f93B3890c382fE9DcD245cbc4';
const CBBTC_PRIME_WRAPPER = '0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147';

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
 * Retired fee wrappers. Each deposited into one registry vault (`underlyingAddress`).
 * They are not listed and cannot be used in the app (only dead shares remain). A wallet's
 * past wrapper history and earned interest count toward the underlying vault.
 */
export interface RetiredFeeWrapper {
  address: string;
  /** Share token label (e.g. wmpUSDC). */
  vaultSymbol: string;
  underlyingAddress: string;
}

const RETIRED_FEE_WRAPPERS: readonly RetiredFeeWrapper[] = [
  { address: USDC_PRIME_WRAPPER, vaultSymbol: 'wmpUSDC', underlyingAddress: USDC_PRIME },
  { address: USDC_FRONTIER_WRAPPER, vaultSymbol: 'wmfUSDC', underlyingAddress: USDC_FRONTIER },
  { address: WETH_PRIME_WRAPPER, vaultSymbol: 'wmpWETH', underlyingAddress: WETH_PRIME },
  { address: CBBTC_PRIME_WRAPPER, vaultSymbol: 'wmpcbBTC', underlyingAddress: CBBTC_PRIME },
];

/** The retired fee wrapper that deposited into this registry vault, if any. */
export function getRetiredWrapper(underlyingAddress: string): RetiredFeeWrapper | undefined {
  const key = underlyingAddress.toLowerCase();
  return RETIRED_FEE_WRAPPERS.find((wrapper) => wrapper.underlyingAddress.toLowerCase() === key);
}

/** The registry vault a retired fee wrapper deposited into, if this address is one. */
export function getRetiredWrapperUnderlying(wrapperAddress: string): string | undefined {
  const key = wrapperAddress.toLowerCase();
  return RETIRED_FEE_WRAPPERS.find((wrapper) => wrapper.address.toLowerCase() === key)
    ?.underlyingAddress;
}

/** This vault plus its retired wrapper: the addresses whose history counts as one position. */
export function getProductVaultAddresses(address: string): string[] {
  const wrapper = getRetiredWrapper(address);
  return wrapper ? [address, wrapper.address] : [address];
}
