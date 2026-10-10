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
  /** Legacy fee wrapper: holders can withdraw; no new deposits. */
  withdrawOnly?: true;
  /** Legacy wrapper only: the registry vault it deposits into. */
  underlyingAddress?: string;
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
 * Retired fee wrappers. Each deposits into one registry vault above. They are not listed
 * or gate-checked; a wallet sees one only while it holds shares, so it can withdraw.
 * Delete an entry once Morpho shows its TVL at ~0.
 */
export const LEGACY_WRAPPER_VAULTS: Record<string, VaultDefinition> = {
  USDC_PRIME_WRAPPER: {
    address: '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45',
    name: 'Muscadine USDC Prime',
    symbol: 'USDC',
    vaultSymbol: 'wmpUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    withdrawOnly: true,
    underlyingAddress: USDC_PRIME,
  },
  USDC_FRONTIER_WRAPPER: {
    address: '0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A',
    name: 'Muscadine USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'wmfUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'frontier',
    withdrawOnly: true,
    underlyingAddress: USDC_FRONTIER,
  },
  WETH_PRIME_WRAPPER: {
    address: '0x548653b09b03A69f93B3890c382fE9DcD245cbc4',
    name: 'Muscadine WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'wmpWETH',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    withdrawOnly: true,
    underlyingAddress: WETH_PRIME,
  },
  CBBTC_PRIME_WRAPPER: {
    address: '0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147',
    name: 'Muscadine cbBTC Prime',
    symbol: 'cbBTC',
    vaultSymbol: 'wmpcbBTC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    withdrawOnly: true,
    underlyingAddress: CBBTC_PRIME,
  },
};

export function getLegacyVaultList(): VaultDefinition[] {
  return Object.values(LEGACY_WRAPPER_VAULTS);
}

/** Legacy wrapper that deposits into this registry vault, if any. */
export function findLegacyWrapperFor(underlyingAddress: string): VaultDefinition | undefined {
  const key = underlyingAddress.toLowerCase();
  return getLegacyVaultList().find((vault) => vault.underlyingAddress?.toLowerCase() === key);
}

/** The other contract of a registry vault / legacy wrapper pair, if there is one. */
export function getPairedVaultAddress(address: string): string | undefined {
  const key = address.toLowerCase();
  const legacy = getLegacyVaultList().find((vault) => vault.address.toLowerCase() === key);
  if (legacy) return legacy.underlyingAddress;
  return findLegacyWrapperFor(address)?.address;
}

/**
 * Addresses whose position counts as one product on this vault's page: a registry vault
 * plus its legacy wrapper. A wrapper page shows only the wrapper, since that is what it withdraws.
 */
export function getProductVaultAddresses(address: string): string[] {
  const wrapper = findLegacyWrapperFor(address);
  return wrapper ? [address, wrapper.address] : [address];
}

