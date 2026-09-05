import {
  VaultDefinition,
  VaultKind,
  VaultStrategy,
  findWrapperForUnderlying,
  getRegistryVaultList,
} from '@/lib/vaults';
import { isUnderlyingVisible } from '@/lib/vault-access';
import { Vault } from '@/types/vault';
import {
  DEFAULT_MORPHO_ASSET_SYMBOL,
  getAssetDecimalsForSymbol,
  morphoAmountToDecimal,
  resolveMorphoAssetSymbol,
} from '@/lib/asset-decimals';
import { BASE_CHAIN_ID } from '@/lib/constants';

/** Morpho holding row from WalletContext (minimal shape for display helpers). */
export interface WalletMorphoPosition {
  shares: string;
  assets?: string;
  assetsUsd?: number;
  assetDecimals?: number;
  pnl?: number;
  pnlUsd?: number;
  pnlRaw?: string;
  vault: {
    address: string;
    name?: string;
    symbol?: string;
    vaultSymbol?: string;
    strategy?: VaultStrategy;
    kind?: VaultKind;
    isCurated?: boolean;
    state?: {
      sharePriceUsd?: number;
      totalAssetsUsd?: number;
      totalSupply?: string;
    };
  };
}

export function hasOnChainVaultShares(
  position: WalletMorphoPosition | undefined | null
): boolean {
  if (!position?.shares) return false;
  try {
    return BigInt(position.shares) > BigInt(0);
  } catch {
    return false;
  }
}

/** All-time earned USD from Morpho `pnlUsd` for the given vaults (positive only). */
export function sumPositivePnlUsd(
  positions: readonly WalletMorphoPosition[],
  vaultAddresses?: ReadonlyArray<string>
): number {
  const allowed =
    vaultAddresses === undefined
      ? null
      : new Set(vaultAddresses.map((address) => address.toLowerCase()));

  let total = 0;
  for (const position of positions) {
    if (!hasOnChainVaultShares(position)) continue;
    if (allowed && !allowed.has(position.vault.address.toLowerCase())) continue;
    const usd = position.pnlUsd;
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      total += usd;
    }
  }
  return total;
}

/** All-time earned raw amount from Morpho `pnlRaw` for the given vaults (positive only). */
export function sumPositivePnlRaw(
  positions: readonly WalletMorphoPosition[],
  vaultAddresses: ReadonlyArray<string>
): bigint {
  const allowed = new Set(vaultAddresses.map((address) => address.toLowerCase()));

  let total = BigInt(0);
  for (const position of positions) {
    if (!hasOnChainVaultShares(position)) continue;
    if (!allowed.has(position.vault.address.toLowerCase())) continue;
    if (!position.pnlRaw) continue;
    try {
      const raw = BigInt(position.pnlRaw);
      if (raw > BigInt(0)) total += raw;
    } catch {
      // skip malformed raw amounts
    }
  }
  return total;
}

/** USD value for tables/selectors; falls back when assetsUsd was not priced yet. */
export function resolvePositionAssetsUsd(
  position: WalletMorphoPosition,
  options?: {
    assetDecimals?: number;
    assetPriceUsd?: number;
    symbol?: string;
  }
): number {
  if (position.assetsUsd !== undefined && position.assetsUsd > 0) {
    return position.assetsUsd;
  }

  const symbol = (options?.symbol ?? position.vault.symbol ?? '').toUpperCase();
  const decimals =
    options?.assetDecimals ??
    position.assetDecimals ??
    getAssetDecimalsForSymbol(symbol);

  if (position.assets) {
    try {
      const assetsDecimal = morphoAmountToDecimal(position.assets, decimals);
      let price = options?.assetPriceUsd ?? 0;
      if (price <= 0 && symbol === 'USDC') price = 1;
      if (assetsDecimal > 0 && price > 0) {
        return assetsDecimal * price;
      }
    } catch {
      // fall through to sharePriceUsd
    }
  }

  const sharesDecimal = parseFloat(position.shares) / 1e18;
  const sharePriceUsd = position.vault.state?.sharePriceUsd ?? 0;
  if (sharesDecimal > 0 && sharePriceUsd > 0) {
    return sharesDecimal * sharePriceUsd;
  }

  return 0;
}

function findWalletPosition(
  positions: WalletMorphoPosition[],
  vaultAddress: string
): WalletMorphoPosition | undefined {
  const key = vaultAddress.toLowerCase();
  return positions.find((p) => p.vault.address.toLowerCase() === key);
}

/**
 * Sort vault lists: user position USD (high → low), then TVL (high → low).
 */
export function compareVaultsForDisplay(
  a: Vault,
  b: Vault,
  positions: WalletMorphoPosition[],
  getTvlUsd: (address: string) => number
): number {
  const positionA = findWalletPosition(positions, a.address);
  const positionB = findWalletPosition(positions, b.address);

  const usdA = positionA
    ? resolvePositionAssetsUsd(positionA, { symbol: a.symbol })
    : 0;
  const usdB = positionB
    ? resolvePositionAssetsUsd(positionB, { symbol: b.symbol })
    : 0;
  if (usdA !== usdB) return usdB - usdA;

  const tvlA = getTvlUsd(a.address);
  const tvlB = getTvlUsd(b.address);
  if (tvlA !== tvlB) return tvlB - tvlA;

  return a.name.localeCompare(b.name) || (a.vaultSymbol ?? '').localeCompare(b.vaultSymbol ?? '');
}

export function sortVaultsForDisplay(
  vaults: Vault[],
  positions: WalletMorphoPosition[],
  getTvlUsd: (address: string) => number
): Vault[] {
  return [...vaults].sort((a, b) =>
    compareVaultsForDisplay(a, b, positions, getTvlUsd)
  );
}

export function registryDefinitionToVault(vault: VaultDefinition): Vault {
  return {
    address: vault.address,
    name: vault.name,
    symbol: vault.symbol,
    vaultSymbol: vault.vaultSymbol,
    chainId: vault.chainId,
    version: vault.version,
    strategy: vault.strategy,
    kind: vault.kind,
    underlyingAddress: vault.underlyingAddress,
    isCurated: true,
  };
}

export function getAllRegistryVaults(): Vault[] {
  return getRegistryVaultList().map(registryDefinitionToVault);
}

/**
 * Find a vault by its address (case-insensitive)
 */
export function findVaultByAddress(address: string): Vault | null {
  if (!address) return null;

  const normalizedAddress = address.toLowerCase().trim();
  const vault = getRegistryVaultList().find(
    (v) => v.address.toLowerCase() === normalizedAddress
  );

  if (!vault) return null;

  return registryDefinitionToVault(vault);
}

export function isCuratedVaultAddress(address: string): boolean {
  return findVaultByAddress(address) !== null;
}

/** Minimal vault stub for external Morpho vaults not in the Muscadine registry. */
export function createExternalVaultStub(
  address: string,
  options?: { name?: string; symbol?: string; chainId?: number }
): Vault {
  return {
    address,
    name: options?.name ?? `${address.slice(0, 6)}...${address.slice(-4)}`,
    symbol: options?.symbol ?? DEFAULT_MORPHO_ASSET_SYMBOL,
    chainId: options?.chainId ?? BASE_CHAIN_ID,
    version: 'v2',
    isCurated: false,
  };
}

export type VaultWalletFilterMode = 'all' | 'inWallet' | 'inWalletAndWhitelisted';

export type VaultKindFilter = 'all' | 'underlying' | 'wrappers';

export function getDepositedVaultAddressSet(
  positions: WalletMorphoPosition[]
): Set<string> {
  return new Set(
    positions
      .filter(hasOnChainVaultShares)
      .map((position) => position.vault.address.toLowerCase())
  );
}

/**
 * Dashboard Your Vaults: one row per held side of a wrapper/underlying pair.
 * Both appear only when the wallet holds shares in both contracts.
 */
export function filterDashboardDepositedVaults(
  vaults: Vault[],
  depositedAddresses: ReadonlySet<string>
): Vault[] {
  const drop = new Set<string>();

  for (const def of getRegistryVaultList()) {
    if (def.kind !== 'wrapper' || !def.underlyingAddress) continue;
    const wrapperKey = def.address.toLowerCase();
    const underlyingKey = def.underlyingAddress.toLowerCase();
    const hasWrapper = depositedAddresses.has(wrapperKey);
    const hasUnderlying = depositedAddresses.has(underlyingKey);

    if (hasWrapper && hasUnderlying) continue;
    if (hasWrapper) drop.add(underlyingKey);
    if (hasUnderlying) drop.add(wrapperKey);
  }

  return vaults.filter((vault) => !drop.has(vault.address.toLowerCase()));
}

/** Dashboard kind pill — only when the wallet holds wrapper and underlying for the pair. */
export function userHoldsBothVaultPairSides(
  vault: Vault,
  depositedAddresses: ReadonlySet<string>
): boolean {
  if (vault.kind === 'wrapper' && vault.underlyingAddress) {
    return (
      depositedAddresses.has(vault.address.toLowerCase()) &&
      depositedAddresses.has(vault.underlyingAddress.toLowerCase())
    );
  }
  if (vault.kind === 'underlying') {
    const wrapper = findWrapperForUnderlying(vault.address);
    if (!wrapper) return false;
    return (
      depositedAddresses.has(wrapper.address.toLowerCase()) &&
      depositedAddresses.has(vault.address.toLowerCase())
    );
  }
  return false;
}

/**
 * /vaults explorer: gate-eligible underlyings stay visible (even with no shares).
 * Otherwise hide the unheld sibling — wrapper-only drops underlying, not vice versa.
 */
export function collapseExplorerRegistryVaultPairs(
  vaults: Vault[],
  depositedAddresses: ReadonlySet<string>,
  eligibleUnderlyingAddresses: ReadonlySet<string>
): Vault[] {
  const drop = new Set<string>();

  for (const def of getRegistryVaultList()) {
    if (def.kind !== 'wrapper' || !def.underlyingAddress) continue;
    const wrapperKey = def.address.toLowerCase();
    const underlyingKey = def.underlyingAddress.toLowerCase();

    if (eligibleUnderlyingAddresses.has(underlyingKey)) continue;

    const hasWrapper = depositedAddresses.has(wrapperKey);
    const hasUnderlying = depositedAddresses.has(underlyingKey);
    if (hasWrapper && hasUnderlying) continue;
    if (hasWrapper && !hasUnderlying) drop.add(underlyingKey);
  }

  return vaults.filter((vault) => !drop.has(vault.address.toLowerCase()));
}

/** Registry vaults for the explorer: wrappers always; underlyings by live gate or shares. */
export function selectRegistryVaultsForExplorer(options: {
  kindFilter: VaultKindFilter;
  depositedAddresses: ReadonlySet<string>;
  eligibleUnderlyingAddresses: ReadonlySet<string>;
}): Vault[] {
  const accessible = getAllRegistryVaults().filter((vault) =>
    isUnderlyingVisible({
      vaultKind: vault.kind,
      vaultAddress: vault.address,
      eligibleUnderlyingAddresses: options.eligibleUnderlyingAddresses,
      depositedAddresses: options.depositedAddresses,
    })
  );

  if (options.kindFilter === 'wrappers') {
    return accessible.filter((vault) => {
      if (vault.kind === 'wrapper') return true;
      return options.depositedAddresses.has(vault.address.toLowerCase());
    });
  }
  if (options.kindFilter === 'underlying') {
    return accessible.filter((vault) => {
      if (vault.kind === 'underlying') return true;
      return options.depositedAddresses.has(vault.address.toLowerCase());
    });
  }
  return collapseExplorerRegistryVaultPairs(
    accessible,
    options.depositedAddresses,
    options.eligibleUnderlyingAddresses
  );
}

export function dedupeVaultsByAddress(vaults: Vault[]): Vault[] {
  const seen = new Set<string>();
  const result: Vault[] = [];
  for (const vault of vaults) {
    const key = vault.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(vault);
  }
  return result;
}

/** Registry list + optional wallet/external vaults for the vault explorer. */
export function buildExplorerVaultCandidates(
  registryVaults: Vault[],
  positions: WalletMorphoPosition[],
  walletFilter: VaultWalletFilterMode
): Vault[] {
  if (walletFilter === 'all') {
    return registryVaults;
  }

  const activePositions = positions.filter(hasOnChainVaultShares);
  const depositedKeys = new Set(
    activePositions.map((position) => position.vault.address.toLowerCase())
  );

  const externalVaults: Vault[] = activePositions
    .filter((position) => !isCuratedVaultAddress(position.vault.address))
    .map((position) => {
      const symbol = resolveMorphoAssetSymbol({
        assetSymbol: position.vault.symbol,
        assetDecimals: position.assetDecimals ?? null,
        vaultName: position.vault.name,
      });
      return createExternalVaultStub(position.vault.address, {
        name: position.vault.name,
        symbol,
        chainId: BASE_CHAIN_ID,
      });
    });

  if (walletFilter === 'inWallet') {
    return [
      ...registryVaults.filter((vault) =>
        depositedKeys.has(vault.address.toLowerCase())
      ),
      ...externalVaults,
    ];
  }

  return dedupeVaultsByAddress([...registryVaults, ...externalVaults]);
}

/** Whitelisted registry vault only — external Morpho positions have no detail page. */
export function resolveVaultForPage(address: string): Vault | null {
  if (!address || !isValidEthereumAddress(address)) return null;

  const registryVault = findVaultByAddress(address);
  if (registryVault?.version === 'v2') return registryVault;

  return null;
}

/** Vault write/read product surface is v2 only. */
export function getVaultVersion(
  _address?: string,
  _hint?: 'v1' | 'v2'
): 'v2' {
  void _address;
  void _hint;
  return 'v2';
}

export function getVaultRoute(address: string): string {
  return `/vault/v2/${address}`;
}

export const MUSCADINE_ANALYTICS_ORIGIN = 'https://analytics.muscadine.xyz';

/** Muscadine Analytics vault page (markets, TVL, allocations). */
export function getVaultAnalyticsUrl(address: string): string {
  return `${MUSCADINE_ANALYTICS_ORIGIN}/vault/v2/${address}`;
}

export function getVaultApiPath(address: string, endpoint: string): string {
  return `/api/vault/v2/${address}/${endpoint}`;
}

export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function calculateYAxisDomain(
  values: number[],
  options: {
    bottomPaddingPercent?: number;
    topPaddingPercent?: number;
    thresholdPercent?: number;
    defaultMin?: number;
    filterPositiveOnly?: boolean;
    tokenThreshold?: number;
    /** Anchor balance charts at zero instead of zooming into a narrow band near max. */
    anchorZero?: boolean;
  } = {}
): [number, number] | undefined {
  const {
    bottomPaddingPercent = 0.25,
    topPaddingPercent = 0.2,
    thresholdPercent = 0.02,
    defaultMin = 0,
    filterPositiveOnly = false,
    tokenThreshold,
    anchorZero = false,
  } = options;

  let filteredValues = values.filter(
    (v) => v !== null && v !== undefined && !isNaN(v)
  );

  if (filterPositiveOnly) {
    filteredValues = filteredValues.filter((v) => v > 0);
  }

  if (filteredValues.length === 0) {
    return undefined;
  }

  const minValue = Math.min(...filteredValues);
  const maxValue = Math.max(...filteredValues);

  let adjustedMinValue = minValue;

  if (anchorZero) {
    adjustedMinValue = defaultMin;
  } else if (tokenThreshold !== undefined) {
    if (maxValue >= tokenThreshold) {
      const threshold = maxValue * 0.01;
      adjustedMinValue = minValue < threshold ? defaultMin : minValue;
    }
  } else {
    const threshold = maxValue * thresholdPercent;
    adjustedMinValue = minValue < threshold ? defaultMin : minValue;
  }

  const range = maxValue - adjustedMinValue;
  const bottomPadding = range * bottomPaddingPercent;
  const topPadding = range * topPaddingPercent;

  const domainMin = Math.max(defaultMin, adjustedMinValue - bottomPadding);
  let domainMax = maxValue + topPadding;

  if (domainMax <= domainMin) {
    domainMax = domainMin === defaultMin ? defaultMin + (maxValue > 0 ? maxValue * 0.1 : 100) : domainMin + 1;
  }

  return [domainMin, domainMax];
}

export function calculateCurrentAssetsRaw(options: {
  positionAssets?: string | number | bigint | null;
  positionShares?: string | number | null;
  sharePriceInAsset?: number | null;
  totalAssets?: string | number | null;
  totalSupply?: string | number | null;
  assetDecimals?: number | null;
}): bigint {
  const {
    positionAssets,
    positionShares,
    sharePriceInAsset,
    totalAssets,
    totalSupply,
    assetDecimals = 18,
  } = options;

  if (positionAssets !== undefined && positionAssets !== null) {
    try {
      const assets = BigInt(positionAssets);
      if (assets > BigInt(0)) return assets;
    } catch {
      // ignore parse errors
    }
  }

  const sharesRaw = positionShares !== undefined && positionShares !== null ? (() => {
    try {
      return BigInt(positionShares);
    } catch {
      return BigInt(0);
    }
  })() : BigInt(0);

  const sharesDecimal = Number(sharesRaw) / 1e18;
  const decimals = assetDecimals ?? 18;

  const toRaw = (value: number) => {
    if (!value || !isFinite(value) || value <= 0) return BigInt(0);
    return BigInt(Math.floor(value * Math.pow(10, decimals)));
  };

  if (sharesDecimal > 0 && sharePriceInAsset && sharePriceInAsset > 0 && isFinite(sharePriceInAsset)) {
    const raw = toRaw(sharesDecimal * sharePriceInAsset);
    if (raw > BigInt(0)) return raw;
  }

  if (sharesDecimal > 0) {
    let totalAssetsRaw = BigInt(0);
    let totalSupplyRaw = BigInt(0);

    try {
      if (totalAssets !== undefined && totalAssets !== null) {
        totalAssetsRaw = BigInt(totalAssets);
      }
    } catch {
      // ignore
    }

    try {
      if (totalSupply !== undefined && totalSupply !== null) {
        totalSupplyRaw = BigInt(totalSupply);
      }
    } catch {
      // ignore
    }

    if (totalAssetsRaw > BigInt(0) && totalSupplyRaw > BigInt(0)) {
      const totalAssetsDecimal = Number(totalAssetsRaw) / Math.pow(10, decimals);
      const totalSupplyDecimal = Number(totalSupplyRaw) / 1e18;

      if (totalSupplyDecimal > 0 && totalAssetsDecimal > 0) {
        const sharePrice = totalAssetsDecimal / totalSupplyDecimal;
        const raw = toRaw(sharesDecimal * sharePrice);
        if (raw > BigInt(0)) return raw;
      }
    }
  }

  return BigInt(0);
}

export function resolveAssetPriceUsd(options: {
  quotedPriceUsd?: number | null;
  vaultData?: {
    totalValueLocked?: number;
    totalAssets?: string | number | null;
    assetDecimals?: number;
    sharePrice?: number;
  };
  fallbackSharePriceUsd?: number;
  assetDecimals?: number;
}): number {
  const { quotedPriceUsd, vaultData, fallbackSharePriceUsd, assetDecimals } = options;

  if (typeof quotedPriceUsd === 'number' && isFinite(quotedPriceUsd) && quotedPriceUsd > 0) {
    return quotedPriceUsd;
  }

  const decimals = assetDecimals ?? vaultData?.assetDecimals ?? 18;

  if (
    vaultData?.totalValueLocked &&
    typeof vaultData.totalAssets !== 'undefined' &&
    vaultData.totalAssets !== null
  ) {
    try {
      const totalAssetsRaw = BigInt(vaultData.totalAssets);
      if (totalAssetsRaw > BigInt(0)) {
        const totalAssetsDecimal = Number(totalAssetsRaw) / Math.pow(10, decimals);
        if (totalAssetsDecimal > 0) {
          return vaultData.totalValueLocked / totalAssetsDecimal;
        }
      }
    } catch {
      // ignore
    }
  }

  if (
    fallbackSharePriceUsd &&
    vaultData?.sharePrice &&
    fallbackSharePriceUsd > 0 &&
    vaultData.sharePrice > 0
  ) {
    return fallbackSharePriceUsd / vaultData.sharePrice;
  }

  return 0;
}
