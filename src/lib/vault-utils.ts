import {
  VaultDefinition,
  VaultStrategy,
  findRetiredWrapperFor,
  getRegistryVaultList,
  isRetiredWrapperAddress,
} from '@/lib/vaults';
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
 * Profit on a registry vault's retired wrapper. Wrappers never get a row, so the
 * registry vault's row carries it.
 */
export function closedPairEarnedPnl(
  positions: readonly WalletMorphoPosition[],
  vaultAddress: string
): { pnlRaw: string; pnlUsd: number } | null {
  const pairAddress = findRetiredWrapperFor(vaultAddress)?.address;
  if (!pairAddress) return null;
  const pair = positions.find(
    (position) => position.vault.address.toLowerCase() === pairAddress.toLowerCase()
  );
  if (!pair || !pair.pnlRaw) return null;
  let pnlRaw: bigint;
  try {
    pnlRaw = BigInt(pair.pnlRaw);
  } catch {
    return null;
  }
  // A loss on the closed contract must not shrink the open row. The vault page
  // floors each side at zero. Skip the pair when the dollar figure is missing.
  if (pnlRaw <= BigInt(0) || pair.pnlUsd === undefined || !(pair.pnlUsd > 0)) {
    return null;
  }
  return { pnlRaw: pnlRaw.toString(), pnlUsd: pair.pnlUsd };
}

/** Registry vaults the explorer lists: deposit-eligible, or held so the owner can exit. */
export function selectRegistryVaultsForExplorer(options: {
  depositedAddresses: ReadonlySet<string>;
  eligibleVaultAddresses: ReadonlySet<string>;
}): Vault[] {
  return getAllRegistryVaults().filter((vault) => {
    const key = vault.address.toLowerCase();
    return options.eligibleVaultAddresses.has(key) || options.depositedAddresses.has(key);
  });
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
    .filter(
      (position) =>
        !isCuratedVaultAddress(position.vault.address) &&
        !isRetiredWrapperAddress(position.vault.address)
    )
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

export function getVaultRoute(address: string): string {
  return `/vault/v2/${address}`;
}

export const MUSCADINE_ANALYTICS_ORIGIN = 'https://analytics.muscadine.xyz';

/** Muscadine Analytics vault page (markets, TVL, allocations). */
export function getVaultAnalyticsUrl(address: string): string {
  return `${MUSCADINE_ANALYTICS_ORIGIN}/vault/v2/${address}`;
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
