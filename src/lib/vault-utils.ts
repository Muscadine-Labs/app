import { VAULTS, VaultVersion } from './vaults';
import { Vault } from '../types/vault';

/** Morpho holding row from WalletContext (minimal shape for display helpers). */
export interface WalletMorphoPosition {
  shares: string;
  assets?: string;
  assetsUsd?: number;
  vault: {
    address: string;
    name?: string;
    symbol?: string;
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
    options?.assetDecimals ?? (symbol === 'USDC' ? 6 : symbol === 'CBBTC' || symbol === 'BTC' ? 8 : 18);

  if (position.assets) {
    try {
      const assetsDecimal = Number(position.assets) / Math.pow(10, decimals);
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

/**
 * Keep version filter for browsing, but always include vaults where the user has shares
 * (e.g. v1 deposits while the UI default filter is v2).
 */
export function mergeRegistryVaultsWithDeposits(
  registryVaults: Vault[],
  positions: WalletMorphoPosition[],
  versionFilter: VaultVersion | 'all'
): Vault[] {
  if (versionFilter === 'all') {
    return registryVaults;
  }

  const seen = new Set(registryVaults.map((v) => v.address.toLowerCase()));
  const extras: Vault[] = [];

  for (const position of positions) {
    if (!hasOnChainVaultShares(position)) continue;
    const vault = findVaultByAddress(position.vault.address);
    if (!vault) continue;
    const key = vault.address.toLowerCase();
    if (seen.has(key)) continue;
    extras.push(vault);
    seen.add(key);
  }

  return extras.length > 0 ? [...extras, ...registryVaults] : registryVaults;
}

function vaultVersionSortRank(version: VaultVersion): number {
  return version === 'v2' ? 2 : 1;
}

function findWalletPosition(
  positions: WalletMorphoPosition[],
  vaultAddress: string
): WalletMorphoPosition | undefined {
  const key = vaultAddress.toLowerCase();
  return positions.find((p) => p.vault.address.toLowerCase() === key);
}

/**
 * Sort vault lists: user position USD (high → low), then v2 before v1, then TVL (high → low).
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

  const versionDiff =
    vaultVersionSortRank(b.version ?? 'v1') - vaultVersionSortRank(a.version ?? 'v1');
  if (versionDiff !== 0) return versionDiff;

  const tvlA = getTvlUsd(a.address);
  const tvlB = getTvlUsd(b.address);
  if (tvlA !== tvlB) return tvlB - tvlA;

  return a.name.localeCompare(b.name);
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

/**
 * Find a vault by its address (case-insensitive)
 * @param address - The vault address to search for
 * @returns The vault if found, null otherwise (includes version)
 */
export function findVaultByAddress(address: string): Vault | null {
  if (!address) return null;
  
  const normalizedAddress = address.toLowerCase().trim();
  const vault = Object.values(VAULTS).find(
    (v) => v.address.toLowerCase() === normalizedAddress
  );
  
  if (!vault) return null;
  
  return {
    address: vault.address,
    name: vault.name,
    symbol: vault.symbol,
    chainId: vault.chainId,
    version: vault.version,
  };
}

/**
 * Get the vault version for an address
 * @param address - The vault address
 * @returns The vault version ('v1' or 'v2'), defaults to 'v1' if not found
 */
export function getVaultVersion(address: string): VaultVersion {
  const vault = findVaultByAddress(address);
  return vault?.version || 'v1';
}

/**
 * Validate if an address is a valid vault address
 * @param address - The address to validate
 * @returns True if the address is a valid vault address
 */
export function validateVaultAddress(address: string): boolean {
  return findVaultByAddress(address) !== null;
}

/**
 * Get the route path for a vault
 * @param address - The vault address
 * @param version - Optional vault version ('v1' or 'v2'). If not provided, automatically determines from vault definition
 * @returns The route path (e.g., "/vault/v1/0x...")
 */
export function getVaultRoute(address: string, version?: VaultVersion): string {
  const vaultVersion = version || getVaultVersion(address);
  return `/vault/${vaultVersion}/${address}`;
}

/**
 * Get the API path for a vault endpoint
 * @param address - The vault address
 * @param endpoint - The API endpoint (e.g., 'complete', 'history', 'activity', 'position-history')
 * @param version - Optional vault version ('v1' or 'v2'). If not provided, automatically determines from vault definition
 * @returns The API path (e.g., "/api/vault/v1/0x.../complete")
 */
export function getVaultApiPath(address: string, endpoint: string, version?: VaultVersion): string {
  const vaultVersion = version || getVaultVersion(address);
  return `/api/vault/${vaultVersion}/${address}/${endpoint}`;
}

/**
 * Check if an address is a valid Ethereum address format
 * @param address - The address to check
 * @returns True if the address matches the Ethereum address format
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Calculate Y-axis domain for charts with padding
 * @param values - Array of numeric values to calculate domain from
 * @param options - Configuration options
 * @returns [min, max] domain array or undefined if no valid values
 */
export function calculateYAxisDomain(
  values: number[],
  options: {
    bottomPaddingPercent?: number; // Default: 0.25 (25%)
    topPaddingPercent?: number; // Default: 0.2 (20%)
    thresholdPercent?: number; // Default: 0.02 (2%) - percentage of max to consider "close to 0"
    defaultMin?: number; // Default: 0
    filterPositiveOnly?: boolean; // Default: false
    tokenThreshold?: number; // If provided and maxValue >= this, use different threshold for tokens
  } = {}
): [number, number] | undefined {
  const {
    bottomPaddingPercent = 0.25,
    topPaddingPercent = 0.2,
    thresholdPercent = 0.02,
    defaultMin = 0,
    filterPositiveOnly = false,
    tokenThreshold,
  } = options;

  // Filter values
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

  // Determine threshold and adjustment logic
  let adjustedMinValue = minValue;
  
  if (tokenThreshold !== undefined) {
    // Token-specific logic: only adjust to 0 if max >= tokenThreshold
    if (maxValue >= tokenThreshold) {
      const threshold = maxValue * 0.01; // 1% for tokens when max >= tokenThreshold
      adjustedMinValue = minValue < threshold ? 0 : minValue;
    }
    // If max < tokenThreshold, keep the actual minValue (don't adjust to 0)
  } else {
    // Standard logic: use thresholdPercent
    const threshold = maxValue * thresholdPercent;
    adjustedMinValue = minValue < threshold ? 0 : minValue;
  }

  // Calculate padding
  const range = maxValue - adjustedMinValue;
  const bottomPadding = range * bottomPaddingPercent;
  const topPadding = range * topPaddingPercent;

  // Calculate domain
  const domainMin = Math.max(defaultMin, adjustedMinValue - bottomPadding);
  const domainMax = maxValue + topPadding;

  return [domainMin, domainMax];
}

/**
 * Derive the user's current asset balance in raw units.
 * Priority:
 * 1) position.assets (already raw)
 * 2) shares * sharePriceInAsset (tokens per share)
 * 3) shares * (totalAssets / totalSupply)
 */
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

  // Use reported assets first
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

  // Use provided share price in asset terms
  if (sharesDecimal > 0 && sharePriceInAsset && sharePriceInAsset > 0 && isFinite(sharePriceInAsset)) {
    const raw = toRaw(sharesDecimal * sharePriceInAsset);
    if (raw > BigInt(0)) return raw;
  }

  // Fallback: derive share price from total assets / total supply
  if (sharesDecimal > 0) {
    let totalAssetsRaw = BigInt(0);
    let totalSupplyRaw = BigInt(0);

    try {
      if (totalAssets !== undefined && totalAssets !== null) {
        totalAssetsRaw = BigInt(totalAssets);
      }
    } catch {
      // ignore parse errors
    }

    try {
      if (totalSupply !== undefined && totalSupply !== null) {
        totalSupplyRaw = BigInt(totalSupply);
      }
    } catch {
      // ignore parse errors
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

/**
 * Resolve an asset price in USD with sensible fallbacks.
 * - Use quoted price if present
 * - Else derive from TVL/totalAssets when available
 * - Else approximate from sharePriceUsd/sharePrice if both exist
 */
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

  // Derive from totalValueLocked and totalAssets
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
      // ignore parse errors
    }
  }

  // Approximate using share price in USD vs share price in asset terms if provided
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

