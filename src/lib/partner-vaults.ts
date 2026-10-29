import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
} from '@/lib/constants';
import type { RemoteCuratorFilter } from '@/lib/curator-vaults';
import type { VaultStrategy } from '@/lib/vaults';
import type { Vault } from '@/types/vault';

/**
 * Vaults the app will open and transact with, besides Muscadine.
 * Addresses are pinned here. The explorer does not accept a vault address from the network.
 */
interface PartnerVaultDefinition {
  address: string;
  name: string;
  symbol: string;
  chainId: number;
  assetAddress: string;
  curator: RemoteCuratorFilter;
  strategy?: VaultStrategy;
}

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const ETH_EURC = '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c';
const ETH_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ROBINHOOD_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

/** Assets the explorer can list. Anything else, including MXNB, is left out. */
export const LISTED_ASSETS = ['USDC', 'EURC', 'cbBTC', 'WETH', 'USDG', 'USDT'] as const;
export type ListedAsset = (typeof LISTED_ASSETS)[number];

export function isListedAssetSymbol(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  if (upper === 'CBBTC' || upper === 'CBTC') return true;
  return LISTED_ASSETS.some((asset) => asset.toUpperCase() === upper);
}

const PARTNER_VAULTS: readonly PartnerVaultDefinition[] = [
  // Steakhouse on Base.
  { curator: 'steakhouse-financial', chainId: BASE_CHAIN_ID, symbol: 'USDC', assetAddress: BASE_USDC, name: 'Grove x Steakhouse USDC', address: '0xbeef0786756810478b88982DE00F3CD7fdB8e7c7' },
  { curator: 'steakhouse-financial', chainId: BASE_CHAIN_ID, symbol: 'USDC', assetAddress: BASE_USDC, name: 'Steakhouse Prime USDC', address: '0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9' },
  { curator: 'steakhouse-financial', chainId: BASE_CHAIN_ID, symbol: 'USDC', assetAddress: BASE_USDC, name: 'Steakhouse High Yield USDC', address: '0xbeeff7aE5E00Aae3Db302e4B0d8C883810a58100' },
  { curator: 'steakhouse-financial', chainId: BASE_CHAIN_ID, symbol: 'EURC', assetAddress: BASE_EURC, name: 'Steakhouse Prime EURC', address: '0xbeef009F28cCf367444a9F79096862920e025DC1' },
  { curator: 'steakhouse-financial', chainId: BASE_CHAIN_ID, symbol: 'WETH', assetAddress: BASE_WETH, name: 'Steakhouse Prime ETH', address: '0xbeef00f0A818894a2Cf111644A5098421611100E' },
  // Steakhouse on Ethereum.
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDC', assetAddress: ETH_USDC, name: 'Steakhouse Prime USDC', address: '0xbeef088055857739C12CD3765F20b7679Def0f51' },
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDT', assetAddress: ETH_USDT, name: 'Steakhouse Prime USDT', address: '0xbeef003C68896c7D2c3c60d363e8d71a49Ab2bf9' },
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDC', assetAddress: ETH_USDC, name: 'Steakhouse High Yield USDC', address: '0xbeeff2C5bF38f90e3482a8B19F12E5a6D2FCa757' },
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'WETH', assetAddress: ETH_WETH, name: 'Steakhouse Prime ETH', address: '0xbeef0046fcab1dE47E41fB75BB3dC4Dfc94108E3' },
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDT', assetAddress: ETH_USDT, name: 'Steakhouse High Yield USDT', address: '0xbeeff07d991C04CD640DE9F15C08ba59c4FEDEb7' },
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'EURC', assetAddress: ETH_EURC, name: 'Steakhouse Prime EURC', address: '0xbeef003E31546C7210687f1A7b40d096BE83ec58' },
  { curator: 'steakhouse-financial', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDC', assetAddress: ETH_USDC, name: 'Grove x Steakhouse USDC', address: '0xBeefF08dF54897e7544aB01d0e86f013DA354111' },
  // Steakhouse on Robinhood. One vault.
  { curator: 'steakhouse-financial', chainId: ROBINHOOD_CHAIN_ID, symbol: 'USDG', assetAddress: ROBINHOOD_USDG, name: 'Steakhouse USDG', address: '0xBeEff033F34C046626B8D0A041844C5d1A5409dd', strategy: 'frontier' },
  // Gauntlet on Ethereum.
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDC', assetAddress: ETH_USDC, name: 'Gauntlet USDC Prime', address: '0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0' },
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDC', assetAddress: ETH_USDC, name: 'Gauntlet USDC Frontier', address: '0x9a1D6bd5b8642C41F25e0958129B85f8E1176F3e' },
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDT', assetAddress: ETH_USDT, name: 'Gauntlet USDT Prime', address: '0xf3557AD5E984211ac8A0874A670344f2C3376471' },
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'USDT', assetAddress: ETH_USDT, name: 'Gauntlet USDT Frontier', address: '0xE571B648569619566CF6ce1060C97B621CB635D3' },
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'EURC', assetAddress: ETH_EURC, name: 'Gauntlet EURC Core', address: '0x842A84Df61DbE701c5dAE345F3f8E64aF727E48C' },
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'WETH', assetAddress: ETH_WETH, name: 'Gauntlet WETH Prime', address: '0x43fCd85E8D9D003D515f886891B7C742AC9f92da' },
  { curator: 'gauntlet', chainId: ETHEREUM_CHAIN_ID, symbol: 'WETH', assetAddress: ETH_WETH, name: 'Gauntlet WETH Balanced', address: '0x5f342382D5F77F0f99E8f26161E689df6c7Cded3' },
  // Gauntlet on Base.
  { curator: 'gauntlet', chainId: BASE_CHAIN_ID, symbol: 'USDC', assetAddress: BASE_USDC, name: 'Gauntlet USDC Prime', address: '0x050cE30b927Da55177A4914EC73480238BAD56f0' },
  { curator: 'gauntlet', chainId: BASE_CHAIN_ID, symbol: 'USDC', assetAddress: BASE_USDC, name: 'Gauntlet USDC Frontier', address: '0x1deEfABEe758AAbdC29a542B24ca3b75aFD56765' },
  { curator: 'gauntlet', chainId: BASE_CHAIN_ID, symbol: 'EURC', assetAddress: BASE_EURC, name: 'Gauntlet EURC Balanced', address: '0x94Af495DE1F56Aa5576dEB17986bDCeE5Dd9778D' },
  { curator: 'gauntlet', chainId: BASE_CHAIN_ID, symbol: 'WETH', assetAddress: BASE_WETH, name: 'Gauntlet WETH Balanced', address: '0xFeFeC33668E22677c4762d0853d56245a800ff08' },
  // Bitwise on Base. One USDC vault.
  { curator: 'bitwise', chainId: BASE_CHAIN_ID, symbol: 'USDC', assetAddress: BASE_USDC, name: 'Bitwise Liquid Prime USDC', address: '0x5e03f8965e2957291B3c6990C6Cb9023c36d3d30' },
];

const CURATOR_NAMES: Record<RemoteCuratorFilter, string> = {
  gauntlet: 'Gauntlet',
  bitwise: 'Bitwise',
  'steakhouse-financial': 'Steakhouse',
};

function toVault(vault: PartnerVaultDefinition): Vault {
  return {
    address: vault.address,
    name: vault.name,
    symbol: vault.symbol,
    chainId: vault.chainId,
    version: 'v2',
    curator: CURATOR_NAMES[vault.curator],
    assetAddress: vault.assetAddress,
    strategy: vault.strategy,
    isCurated: false,
  };
}

const PARTNER_VAULT_LIST = PARTNER_VAULTS.filter((vault) => isListedAssetSymbol(vault.symbol)).map(toVault);
const PARTNER_BY_ADDRESS = new Map(
  PARTNER_VAULT_LIST.map((vault) => [vault.address.toLowerCase(), vault])
);
const VAULTS_BY_CURATOR: Record<RemoteCuratorFilter, Vault[]> = {
  gauntlet: PARTNER_VAULT_LIST.filter((vault) => vault.curator === CURATOR_NAMES.gauntlet),
  bitwise: PARTNER_VAULT_LIST.filter((vault) => vault.curator === CURATOR_NAMES.bitwise),
  'steakhouse-financial': PARTNER_VAULT_LIST.filter(
    (vault) => vault.curator === CURATOR_NAMES['steakhouse-financial']
  ),
};

export function getPartnerVaults(curator: RemoteCuratorFilter): Vault[] {
  return VAULTS_BY_CURATOR[curator];
}

export function getAllPartnerVaults(): Vault[] {
  return PARTNER_VAULT_LIST;
}

export function findPartnerVault(address: string): Vault | null {
  return PARTNER_BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

export function isPartnerVaultAddress(address: string): boolean {
  return PARTNER_BY_ADDRESS.has(address.toLowerCase());
}

export function getPartnerVaultAddresses(): string[] {
  return PARTNER_VAULT_LIST.map((vault) => vault.address);
}
