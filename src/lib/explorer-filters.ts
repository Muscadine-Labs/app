import { EXPLORER_NETWORKS, explorerChainId, type ExplorerNetwork } from '@/lib/constants';
import {
  EXPLORER_CURATOR_OPTIONS,
  strategyFromVaultName,
  type NamedVaultCurator,
  type VaultCuratorFilter,
} from '@/lib/curator-vaults';
import { getAllPartnerVaults, isListedAssetSymbol, LISTED_ASSETS, type ListedAsset } from '@/lib/partner-vaults';
import { getAllRegistryVaults } from '@/lib/vault-utils';
import type { VaultStrategy } from '@/lib/vaults';
import type { Vault } from '@/types/vault';

export type VaultAssetFilter = 'all' | ListedAsset;
export type VaultNetworkFilter = 'all' | ExplorerNetwork;
export type VaultStrategyFilter = 'all' | VaultStrategy;
export type VaultWalletFilter = 'all' | 'inWallet' | 'inWalletAndWhitelisted';

export interface VaultExplorerFilterState {
  network: VaultNetworkFilter;
  curator: VaultCuratorFilter;
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
const FILTER_VERSION = '2';

export function getDefaultExplorerFilters(): VaultExplorerFilterState {
  return {
    network: 'base',
    curator: 'muscadine',
    strategy: 'all',
    asset: 'all',
    walletFilter: 'inWalletAndWhitelisted',
  };
}

/**
 * Filters written when the default network was All. A visit that never changed
 * a filter should open on Base instead.
 */
function isLegacyDefaultFilters(filters: VaultExplorerFilterState): boolean {
  return (
    filters.network === 'all' &&
    filters.curator === 'muscadine' &&
    filters.strategy === 'all' &&
    filters.asset === 'all' &&
    filters.walletFilter === 'inWalletAndWhitelisted'
  );
}

export function resolveStoredExplorerFilters(
  candidate: VaultExplorerFilterState | null,
  migrated: boolean
): VaultExplorerFilterState {
  if (!candidate) return getDefaultExplorerFilters();
  if (!migrated && isLegacyDefaultFilters(candidate)) return getDefaultExplorerFilters();
  return candidate;
}

function catalogVaults(): Vault[] {
  return [...getAllRegistryVaults(), ...getAllPartnerVaults()].filter((vault) =>
    isListedAssetSymbol(vault.symbol)
  );
}

function onNetwork(vaults: Vault[], network: VaultNetworkFilter): Vault[] {
  if (network === 'all') return vaults;
  const chainId = explorerChainId(network);
  return vaults.filter((vault) => vault.chainId === chainId);
}

function curatorId(vault: Vault): NamedVaultCurator {
  if (vault.isCurated || vault.curator === 'Muscadine') return 'muscadine';
  if (vault.curator === 'Gauntlet') return 'gauntlet';
  if (vault.curator === 'Bitwise') return 'bitwise';
  return 'steakhouse-financial';
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

export function curatorOptionsForNetwork(
  network: VaultNetworkFilter
): ExplorerFilterOption<VaultCuratorFilter>[] {
  const present = new Set(onNetwork(catalogVaults(), network).map(curatorId));
  const named = EXPLORER_CURATOR_OPTIONS.filter((option) => present.has(option.value));
  if (network === 'all' || named.length > 1) {
    return [{ label: 'All', value: 'all' }, ...named];
  }
  return named;
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

export function strategyOptionsForSelection(
  network: VaultNetworkFilter,
  curator: VaultCuratorFilter
): ExplorerFilterOption<VaultStrategyFilter>[] {
  const vaults = onNetwork(catalogVaults(), network).filter(
    (vault) => curator === 'all' || curatorId(vault) === curator
  );
  const present = new Set(
    vaults.map(vaultStrategy).filter((strategy): strategy is VaultStrategy => strategy !== undefined)
  );
  return [
    { label: 'All', value: 'all' },
    ...STRATEGY_ORDER.filter((strategy) => present.has(strategy)).map((strategy) => ({
      label: strategy === 'prime' ? 'Prime' : 'Frontier',
      value: strategy,
    })),
  ];
}

/** Drop a curator, asset, or strategy the selected network does not have. */
export function reconcileExplorerFilters(
  filters: VaultExplorerFilterState
): VaultExplorerFilterState {
  const curators = curatorOptionsForNetwork(filters.network);
  const curator = curators.some((option) => option.value === filters.curator)
    ? filters.curator
    : (curators.find((option) => option.value === 'all')?.value ?? curators[0]?.value ?? 'muscadine');
  const assets = assetOptionsForNetwork(filters.network);
  const asset = assets.some((option) => option.value === filters.asset) ? filters.asset : 'all';
  const strategies = strategyOptionsForSelection(filters.network, curator);
  const strategy = strategies.some((option) => option.value === filters.strategy)
    ? filters.strategy
    : 'all';
  return { ...filters, curator, asset, strategy };
}

function isNetwork(value: string | null): value is VaultNetworkFilter {
  return value === 'all' || EXPLORER_NETWORKS.some((network) => network.value === value);
}

function isCurator(value: string | null): value is VaultCuratorFilter {
  return value === 'all' || EXPLORER_CURATOR_OPTIONS.some((option) => option.value === value);
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
  const keys = ['network', 'curator', 'strategy', 'asset', 'wallet'];
  if (!keys.some((key) => params.has(key))) return null;
  const defaults = getDefaultExplorerFilters();
  const network = params.get('network');
  const curator = params.get('curator');
  const strategy = params.get('strategy');
  const asset = params.get('asset');
  const wallet = params.get('wallet');
  return reconcileExplorerFilters({
    network: isNetwork(network) ? network : defaults.network,
    curator: isCurator(curator) ? curator : defaults.curator,
    strategy: isStrategy(strategy) ? strategy : defaults.strategy,
    asset: isAsset(asset) ? asset : defaults.asset,
    walletFilter: isWallet(wallet) ? wallet : defaults.walletFilter,
  });
}

export function serializeExplorerFilters(filters: VaultExplorerFilterState): string {
  const params = new URLSearchParams();
  params.set('network', filters.network);
  params.set('curator', filters.curator);
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
    const stored = fromUrl ? null : readStoredExplorerFilters();
    return resolveStoredExplorerFilters(fromUrl ?? stored, migrated);
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
