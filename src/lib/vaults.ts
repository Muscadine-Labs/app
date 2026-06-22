export type VaultVersion = 'v2';

/** Product strategy — Prime (default) or Frontier. */
export type VaultStrategy = 'prime' | 'frontier';

export interface VaultDefinition {
  address: string;
  name: string;
  /** Underlying asset symbol (USDC, cbBTC, WETH). */
  symbol: string;
  /** Share token symbol for display (e.g. mpUSDC, mfUSDC). */
  vaultSymbol: string;
  chainId: number;
  version: VaultVersion;
  strategy: VaultStrategy;
}

export const VAULTS: Record<string, VaultDefinition> = {
  USDC_VAULT_V2: {
    address: '0x89712980Cb434eF5aE4AB29349419eb976B0b496',
    name: 'Muscadine USDC Prime',
    symbol: 'USDC',
    vaultSymbol: 'mpUSDC',
    chainId: 8453,
    version: 'v2',
    strategy: 'prime',
  },
  cbBTC_VAULT_V2: {
    address: '0x99dcd0D75822BA398F13B2A8852B07c7e137EC70',
    name: 'Muscadine cbBTC Prime',
    symbol: 'cbBTC',
    vaultSymbol: 'mpcbBTC',
    chainId: 8453,
    version: 'v2',
    strategy: 'prime',
  },
  WETH_VAULT_V2: {
    address: '0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43',
    name: 'Muscadine WETH Prime',
    symbol: 'WETH',
    vaultSymbol: 'mpWETH',
    chainId: 8453,
    version: 'v2',
    strategy: 'prime',
  },
  USDC_FRONTIER_VAULT_V2: {
    address: '0x314fD07319ef645bA7D548915CCd91F4788A1839',
    name: 'Muscadine USDC Frontier',
    symbol: 'USDC',
    vaultSymbol: 'mfUSDC',
    chainId: 8453,
    version: 'v2',
    strategy: 'frontier',
  },
};
