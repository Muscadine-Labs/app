import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultVersion = 'v2';

/** Product strategy — Prime (default) or Frontier. */
export type VaultStrategy = 'prime' | 'frontier';

/**
 * `underlying` = Morpho Vault V2 that allocates to Blue markets.
 * `wrapper` = fee wrapper: a Vault V2 whose liquidity adapter deposits into one underlying vault.
 */
export type VaultKind = 'underlying' | 'wrapper';

export interface VaultDefinition {
  address: string;
  name: string;
  /** Underlying asset symbol (USDC, cbBTC, WETH). */
  symbol: string;
  /** Share token label (e.g. mpUSDC, wmpUSDC). */
  vaultSymbol: string;
  chainId: number;
  version: VaultVersion;
  strategy: VaultStrategy;
  kind: VaultKind;
  /** Wrapper only: the underlying vault it deposits into. */
  underlyingAddress?: string;
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
    kind: 'underlying',
  },
  cbBTC_VAULT_V2: {
    address: CBBTC_PRIME,
    name: 'Muscadine cbBTC Prime',
    symbol: 'cbBTC',
    vaultSymbol: 'mpcbBTC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'underlying',
  },
  WETH_VAULT_V2: {
    address: WETH_PRIME,
    name: 'Muscadine WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'mpWETH',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'underlying',
  },
  USDC_FRONTIER_VAULT_V2: {
    address: USDC_FRONTIER,
    name: 'Muscadine USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'mfUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'frontier',
    kind: 'underlying',
  },
  USDC_VAULT_V2_WRAPPER: {
    address: USDC_PRIME_WRAPPER,
    name: 'Muscadine USDC Prime',
    symbol: 'USDC',
    vaultSymbol: 'wmpUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'wrapper',
    underlyingAddress: USDC_PRIME,
  },
  cbBTC_VAULT_V2_WRAPPER: {
    address: CBBTC_PRIME_WRAPPER,
    name: 'Muscadine cbBTC Prime',
    symbol: 'cbBTC',
    vaultSymbol: 'wmpcbBTC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'wrapper',
    underlyingAddress: CBBTC_PRIME,
  },
  WETH_VAULT_V2_WRAPPER: {
    address: WETH_PRIME_WRAPPER,
    name: 'Muscadine WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'wmpWETH',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'wrapper',
    underlyingAddress: WETH_PRIME,
  },
  USDC_FRONTIER_VAULT_V2_WRAPPER: {
    address: USDC_FRONTIER_WRAPPER,
    name: 'Muscadine USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'wmfUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'frontier',
    kind: 'wrapper',
    underlyingAddress: USDC_FRONTIER,
  },
};

export function getRegistryVaultList(): VaultDefinition[] {
  return Object.values(VAULTS);
}

function findDefinition(address: string): VaultDefinition | undefined {
  const key = address.toLowerCase();
  return getRegistryVaultList().find((vault) => vault.address.toLowerCase() === key);
}

/** Registry wrapper at this address, if it is one. */
export function findWrapperDefinition(address: string): VaultDefinition | undefined {
  const vault = findDefinition(address);
  return vault?.kind === 'wrapper' ? vault : undefined;
}

export function isWrapperVaultAddress(address: string): boolean {
  return findWrapperDefinition(address) !== undefined;
}

/** Wrapper that deposits into this underlying vault, if any. */
export function findWrapperForUnderlying(underlyingAddress: string): VaultDefinition | undefined {
  const key = underlyingAddress.toLowerCase();
  return getRegistryVaultList().find(
    (vault) => vault.kind === 'wrapper' && vault.underlyingAddress?.toLowerCase() === key
  );
}

/** The other contract of a wrapper / underlying pair, if there is one. */
export function getPairedVaultAddress(address: string): string | undefined {
  const wrapper = findWrapperDefinition(address);
  if (wrapper) return wrapper.underlyingAddress;
  return findWrapperForUnderlying(address)?.address;
}

/** This vault plus its pair: the addresses whose history counts as one position. */
export function getProductVaultAddresses(address: string): string[] {
  const pair = getPairedVaultAddress(address);
  return pair ? [address, pair] : [address];
}
