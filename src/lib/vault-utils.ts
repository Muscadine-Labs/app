import { VAULTS, VaultStrategy } from '@/lib/vaults';
import { Vault } from '@/types/vault';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';
import { BASE_CHAIN_ID } from '@/lib/constants';

/** Morpho holding row from WalletContext (minimal shape for display helpers). */
export interface WalletMorphoPosition {
  shares: string;
  assets?: string;
  assetsUsd?: number;
  pnl?: number;
  pnlUsd?: number;
  pnlRaw?: string;
  vault: {
    address: string;
    name?: string;
    symbol?: string;
    vaultSymbol?: string;
    strategy?: VaultStrategy;
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
    options?.assetDecimals ?? getAssetDecimalsForSymbol(symbol);

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
    vaultSymbol: vault.vaultSymbol,
    chainId: vault.chainId,
    version: vault.version,
    strategy: vault.strategy,
    isCurated: true,
  };
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
    symbol: options?.symbol ?? 'UNKNOWN',
    chainId: options?.chainId ?? BASE_CHAIN_ID,
    version: 'v2',
    isCurated: false,
  };
}

/** Registry vault or external stub — used by vault detail pages. */
export function resolveVaultForPage(
  address: string,
  walletPosition?: WalletMorphoPosition
): Vault | null {
  if (!address || !isValidEthereumAddress(address)) return null;

  const registryVault = findVaultByAddress(address);
  if (registryVault) return registryVault;

  return createExternalVaultStub(address, {
    name: walletPosition?.vault.name,
    symbol: walletPosition?.vault.symbol,
    chainId: BASE_CHAIN_ID,
  });
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

export function validateVaultAddress(address: string): boolean {
  return findVaultByAddress(address) !== null;
}

export function getVaultRoute(address: string): string {
  return `/vault/v2/${address}`;
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

  if (tokenThreshold !== undefined) {
    if (maxValue >= tokenThreshold) {
      const threshold = maxValue * 0.01;
      adjustedMinValue = minValue < threshold ? 0 : minValue;
    }
  } else {
    const threshold = maxValue * thresholdPercent;
    adjustedMinValue = minValue < threshold ? 0 : minValue;
  }

  const range = maxValue - adjustedMinValue;
  const bottomPadding = range * bottomPaddingPercent;
  const topPadding = range * topPaddingPercent;

  const domainMin = Math.max(defaultMin, adjustedMinValue - bottomPadding);
  const domainMax = maxValue + topPadding;

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
