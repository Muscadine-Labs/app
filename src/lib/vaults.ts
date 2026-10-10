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
