export type VaultVersion = 'v2';

/** Product strategy — Prime (default) or Frontier. */
export type VaultStrategy = 'prime' | 'frontier';

/**
 * `wrapper` = Morpho fee wrapper (default product surface).
 * `underlying` = inner Morpho Vault V2 the wrapper deposits into.
 */
export type VaultKind = 'wrapper' | 'underlying';

export interface VaultDefinition {
  address: string;
  name: string;
  /** Underlying asset symbol (USDC, cbBTC, WETH). */
  symbol: string;
  /** Share token symbol for display (e.g. mpUSDC, wmpUSDC). */
  vaultSymbol: string;
  chainId: number;
  version: VaultVersion;
  strategy: VaultStrategy;
  kind: VaultKind;
  /** Inner Morpho vault this fee wrapper is immutably bound to. */
  underlyingAddress?: string;
}

const BASE = 8453;

const USDC_PRIME_UNDERLYING = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const USDC_FRONTIER_UNDERLYING = '0x314fD07319ef645bA7D548915CCd91F4788A1839';
const WETH_PRIME_UNDERLYING = '0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43';
const CBBTC_PRIME_UNDERLYING = '0x99dcd0D75822BA398F13B2A8852B07c7e137EC70';

export const VAULTS: Record<string, VaultDefinition> = {
  USDC_VAULT_V2_WRAPPER: {
    address: '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45',
    name: 'USDC Prime',
    symbol: 'USDC',
    vaultSymbol: 'wmpUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'wrapper',
    underlyingAddress: USDC_PRIME_UNDERLYING,
  },
  USDC_FRONTIER_VAULT_V2_WRAPPER: {
    address: '0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A',
    name: 'USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'wmfUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'frontier',
    kind: 'wrapper',
    underlyingAddress: USDC_FRONTIER_UNDERLYING,
  },
  WETH_VAULT_V2_WRAPPER: {
    address: '0x548653b09b03A69f93B3890c382fE9DcD245cbc4',
    name: 'WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'wmpWETH',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'wrapper',
    underlyingAddress: WETH_PRIME_UNDERLYING,
  },
  USDC_VAULT_V2: {
    address: USDC_PRIME_UNDERLYING,
    name: 'Muscadine USDC Prime',
    symbol: 'USDC',
    vaultSymbol: 'mpUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'underlying',
  },
  cbBTC_VAULT_V2: {
    address: CBBTC_PRIME_UNDERLYING,
    name: 'Muscadine cbBTC Prime',
    symbol: 'cbBTC',
    vaultSymbol: 'mpcbBTC',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'underlying',
  },
  WETH_VAULT_V2: {
    address: WETH_PRIME_UNDERLYING,
    name: 'Muscadine WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'mpWETH',
    chainId: BASE,
    version: 'v2',
    strategy: 'prime',
    kind: 'underlying',
  },
  USDC_FRONTIER_VAULT_V2: {
    address: USDC_FRONTIER_UNDERLYING,
    name: 'Muscadine USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'mfUSDC',
    chainId: BASE,
    version: 'v2',
    strategy: 'frontier',
    kind: 'underlying',
  },
};

export function getRegistryVaultList(): VaultDefinition[] {
  return Object.values(VAULTS);
}
