import { EXPLORER_NETWORKS, explorerChainId, type ExplorerNetwork } from '@/lib/constants';
import { getAllRegistryVaults } from '@/lib/vault-utils';
import type { VaultStrategy } from '@/lib/vaults';
import type { Vault } from '@/types/vault';

/** Assets a Muscadine vault can list. cbBTC is also accepted as CBBTC or CBTC. */
export const LISTED_ASSETS = ['USDC', 'cbBTC', 'WETH'] as const;
export type ListedAsset = (typeof LISTED_ASSETS)[number];

export function isListedAssetSymbol(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  if (upper === 'CBBTC' || upper === 'CBTC') return true;
  return LISTED_ASSETS.some((asset) => asset.toUpperCase() === upper);
}

/** Prime or Frontier when the vault name says so. Anything else has no strategy. */
export function strategyFromVaultName(name: string): VaultStrategy | undefined {
  const frontier = /\bfrontier\b/i.test(name);
  const prime = /\bprime\b/i.test(name);
  if (frontier === prime) return undefined;
  return frontier ? 'frontier' : 'prime';
}

export type VaultAssetFilter = 'all' | ListedAsset;
export type VaultNetworkFilter = 'all' | ExplorerNetwork;
export type VaultStrategyFilter = 'all' | VaultStrategy;
export type VaultWalletFilter = 'all' | 'inWallet' | 'inWalletAndWhitelisted';

export interface VaultExplorerFilterState {
  network: VaultNetworkFilter;
  strategy: VaultStrategyFilter;
  asset: VaultAssetFilter;
  walletFilter: VaultWalletFilter;
}

export interface ExplorerFilterOption<T extends string> {
  label: string;
  value: T;
}

const ASSET_ORDER: readonly ListedAsset[] = LISTED_ASSETS;
const STRATEGY_ORDER: readonly VaultStrategy[] = ['prime', 'frontier'];

const FILTER_STORAGE_KEY = 'muscadine.vault-explorer-filters';
const FILTER_VERSION_KEY = 'muscadine.vault-explorer-filters.version';
const FILTER_VERSION = '3';

export function getDefaultExplorerFilters(): VaultExplorerFilterState {
  return {
    network: 'base',
    strategy: 'all',
    asset: 'all',
    walletFilter: 'inWalletAndWhitelisted',
  };
}

function catalogVaults(): Vault[] {
  return getAllRegistryVaults().filter((vault) => isListedAssetSymbol(vault.symbol));
}

function onNetwork(vaults: Vault[], network: VaultNetworkFilter): Vault[] {
  if (network === 'all') return vaults;
  const chainId = explorerChainId(network);
  return vaults.filter((vault) => vault.chainId === chainId);
}

function assetId(symbol: string): ListedAsset | null {
  if (!isListedAssetSymbol(symbol)) return null;
  const upper = symbol.trim().toUpperCase();
  if (upper === 'CBBTC' || upper === 'CBTC') return 'cbBTC';
  return ASSET_ORDER.find((asset) => asset.toUpperCase() === upper) ?? null;
}

function vaultStrategy(vault: Vault): VaultStrategy | undefined {
  return vault.strategy ?? strategyFromVaultName(vault.name);
}

export function networkOptions(): ExplorerFilterOption<VaultNetworkFilter>[] {
  const present = new Set(catalogVaults().map((vault) => vault.chainId));
  const named = EXPLORER_NETWORKS.filter((network) => present.has(network.id)).map((network) => ({
    label: network.label,
    value: network.value,
  }));
  if (named.length > 1) {
    return [{ label: 'All', value: 'all' }, ...named];
  }
  return named.length > 0 ? named : [{ label: 'Base', value: 'base' }];
}

export function assetOptionsForNetwork(
  network: VaultNetworkFilter
): ExplorerFilterOption<VaultAssetFilter>[] {
  const present = new Set(
    onNetwork(catalogVaults(), network)
      .map((vault) => assetId(vault.symbol))
      .filter((asset): asset is Exclude<VaultAssetFilter, 'all'> => asset !== null)
  );
  return [
    { label: 'All', value: 'all' },
    ...ASSET_ORDER.filter((asset) => present.has(asset)).map((asset) => ({
      label: asset,
      value: asset,
    })),
  ];
}

export function strategyOptionsForNetwork(
  network: VaultNetworkFilter
): ExplorerFilterOption<VaultStrategyFilter>[] {
  const present = new Set(
    onNetwork(catalogVaults(), network)
      .map(vaultStrategy)
      .filter((strategy): strategy is VaultStrategy => strategy !== undefined)
  );
  return [
    { label: 'All', value: 'all' },
    ...STRATEGY_ORDER.filter((strategy) => present.has(strategy)).map((strategy) => ({
      label: strategy === 'prime' ? 'Prime' : 'Frontier',
      value: strategy,
    })),
  ];
}

/** Drop a network, asset, or strategy the Muscadine list does not have. */
export function reconcileExplorerFilters(
  filters: VaultExplorerFilterState
): VaultExplorerFilterState {
  const networks = networkOptions();
  const network = networks.some((option) => option.value === filters.network)
    ? filters.network
    : (networks.find((option) => option.value === 'base')?.value ?? networks[0]?.value ?? 'base');
  const assets = assetOptionsForNetwork(network);
  const asset = assets.some((option) => option.value === filters.asset) ? filters.asset : 'all';
  const strategies = strategyOptionsForNetwork(network);
  const strategy = strategies.some((option) => option.value === filters.strategy)
    ? filters.strategy
    : 'all';
  return { network, asset, strategy, walletFilter: filters.walletFilter };
}

function isNetwork(value: string | null): value is VaultNetworkFilter {
  return value === 'all' || EXPLORER_NETWORKS.some((network) => network.value === value);
}

function isStrategy(value: string | null): value is VaultStrategyFilter {
  return value === 'all' || value === 'prime' || value === 'frontier';
}

function isAsset(value: string | null): value is VaultAssetFilter {
  return value === 'all' || ASSET_ORDER.some((asset) => asset === value);
}

function isWallet(value: string | null): value is VaultWalletFilter {
  return value === 'all' || value === 'inWallet' || value === 'inWalletAndWhitelisted';
}

export function parseExplorerFilters(params: URLSearchParams): VaultExplorerFilterState | null {
  const keys = ['network', 'strategy', 'asset', 'wallet'];
  if (!keys.some((key) => params.has(key))) return null;
  const defaults = getDefaultExplorerFilters();
  const network = params.get('network');
  const strategy = params.get('strategy');
  const asset = params.get('asset');
  const wallet = params.get('wallet');
  return reconcileExplorerFilters({
    network: isNetwork(network) ? network : defaults.network,
    strategy: isStrategy(strategy) ? strategy : defaults.strategy,
    asset: isAsset(asset) ? asset : defaults.asset,
    walletFilter: isWallet(wallet) ? wallet : defaults.walletFilter,
  });
}

export function serializeExplorerFilters(filters: VaultExplorerFilterState): string {
  const params = new URLSearchParams();
  params.set('network', filters.network);
  params.set('strategy', filters.strategy);
  params.set('asset', filters.asset);
  params.set('wallet', filters.walletFilter);
  return params.toString();
}

function readStoredExplorerFilters(): VaultExplorerFilterState | null {
  const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<VaultExplorerFilterState>;
  return reconcileExplorerFilters({ ...getDefaultExplorerFilters(), ...parsed });
}

export function loadExplorerFilters(): VaultExplorerFilterState {
  if (typeof window === 'undefined') return getDefaultExplorerFilters();
  const migrated = window.sessionStorage.getItem(FILTER_VERSION_KEY) === FILTER_VERSION;
  try {
    const fromUrl = parseExplorerFilters(new URLSearchParams(window.location.search));
    if (!migrated) return fromUrl ?? getDefaultExplorerFilters();
    const stored = fromUrl ? null : readStoredExplorerFilters();
    return fromUrl ?? stored ?? getDefaultExplorerFilters();
  } catch {
    return getDefaultExplorerFilters();
  }
}

export function persistExplorerFilters(filters: VaultExplorerFilterState): void {
  if (typeof window === 'undefined') return;
  const reconciled = reconcileExplorerFilters(filters);
  try {
    window.sessionStorage.setItem(FILTER_VERSION_KEY, FILTER_VERSION);
    window.sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(reconciled));
  } catch {
    // Private mode can reject storage. The URL still keeps the filters.
  }
  const next = `${window.location.pathname}?${serializeExplorerFilters(reconciled)}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== next) {
    window.history.replaceState(window.history.state, '', next);
  }
}
