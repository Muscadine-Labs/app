import {
  VaultDefinition,
  VaultStrategy,
  getPairedVaultAddress,
  getRegistryVaultList,
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
 * Profit on the other contract of a wrapper / underlying pair, once that contract has
 * no shares. Its row is gone, so the row still shown carries it. When both sides are
 * held, each row keeps its own profit.
 */
export function closedPairEarnedPnl(
  positions: readonly WalletMorphoPosition[],
  vaultAddress: string
): { pnlRaw: string; pnlUsd: number } | null {
  const pairAddress = getPairedVaultAddress(vaultAddress);
  if (!pairAddress) return null;
  const pair = positions.find(
    (position) => position.vault.address.toLowerCase() === pairAddress.toLowerCase()
  );
  if (!pair || hasOnChainVaultShares(pair) || !pair.pnlRaw) return null;
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

/**
 * Which contracts of each wrapper / underlying pair the explorer lists.
 * `recommended`: the one the wallet can deposit into (underlying first), else the underlying view-only.
 * `wrappers`: the wrapper of every pair. `all`: both contracts of every pair.
 * Held vaults are listed in every mode so the wallet can exit.
 */
export type VaultKindMode = 'recommended' | 'wrappers' | 'all';

/**
 * The contract a pair defaults to for this wallet: the underlying if the wallet can deposit
 * into it, else the wrapper if it can, else the underlying (view-only).
 */
export function resolvePairDefaultAddress(
  underlyingAddress: string,
  eligibleVaultAddresses: ReadonlySet<string>
): string {
  const underlyingKey = underlyingAddress.toLowerCase();
  if (eligibleVaultAddresses.has(underlyingKey)) return underlyingKey;
  const wrapper = getPairedVaultAddress(underlyingAddress)?.toLowerCase();
  if (wrapper && eligibleVaultAddresses.has(wrapper)) return wrapper;
  return underlyingKey;
}

/** Registry vaults the explorer lists for this wallet and mode. */
export function selectRegistryVaultsForExplorer(options: {
  depositedAddresses: ReadonlySet<string>;
  eligibleVaultAddresses: ReadonlySet<string>;
  mode?: VaultKindMode;
}): Vault[] {
  const mode = options.mode ?? 'recommended';
  return getAllRegistryVaults().filter((vault) => {
    const key = vault.address.toLowerCase();
    if (options.depositedAddresses.has(key)) return true;
    const underlyingAddress = vault.kind === 'wrapper' ? vault.underlyingAddress : vault.address;
    // A vault with no pair keeps the plain rule: listed when the wallet can deposit.
    if (!underlyingAddress || !getPairedVaultAddress(vault.address)) {
      return options.eligibleVaultAddresses.has(key);
    }
    if (mode === 'all') return true;
    if (mode === 'wrappers') return vault.kind === 'wrapper';
    return resolvePairDefaultAddress(underlyingAddress, options.eligibleVaultAddresses) === key;
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

export function getVaultRoute(address: string): string {
  return `/vault/v2/${address}`;
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

/**
 * Vaults to label Wrapper / Underlying: both contracts of their pair are in the list,
 * so the names alone would be ambiguous.
 */
export function selectVaultKindMarkAddresses(listedVaults: readonly Vault[]): Set<string> {
  const listed = new Set(listedVaults.map((vault) => vault.address.toLowerCase()));
  const marks = new Set<string>();
  for (const vault of listedVaults) {
    const pair = getPairedVaultAddress(vault.address)?.toLowerCase();
    if (pair && listed.has(pair)) marks.add(vault.address.toLowerCase());
  }
  return marks;
}

/** A wrapper / underlying pair shown as one family row, or a lone vault. Underlying first. */
export interface VaultFamily {
  /** Lowercase underlying address (or the vault's own address when it has no pair). */
  key: string;
  members: Vault[];
}

/** Group listed vaults into families, keeping the list's order of first appearance. */
export function groupVaultFamilies(vaults: readonly Vault[]): VaultFamily[] {
  const families: VaultFamily[] = [];
  const byKey = new Map<string, VaultFamily>();
  for (const vault of vaults) {
    const hasPair = getPairedVaultAddress(vault.address) !== undefined;
    const key = (
      hasPair && vault.kind === 'wrapper' && vault.underlyingAddress
        ? vault.underlyingAddress
        : vault.address
    ).toLowerCase();
    let family = byKey.get(key);
    if (!family) {
      family = { key, members: [] };
      byKey.set(key, family);
      families.push(family);
    }
    family.members.push(vault);
  }
  for (const family of families) {
    family.members.sort(
      (a, b) => (a.kind === 'wrapper' ? 1 : 0) - (b.kind === 'wrapper' ? 1 : 0)
    );
  }
  return families;
}

/**
 * Settings → Vault View (Underlying / Wrapper / All Vaults) only matters when the wallet can deposit
 * into both the wrapper and the underlying of some vault, or holds at least one of each kind.
 */
export function resolveCanUseAdvanced(
  eligibleVaultAddresses: ReadonlySet<string>,
  depositedAddresses: ReadonlySet<string>
): boolean {
  const vaults = getRegistryVaultList();
  const canDepositBoth = vaults.some(
    (vault) =>
      vault.kind === 'wrapper' &&
      !!vault.underlyingAddress &&
      eligibleVaultAddresses.has(vault.address.toLowerCase()) &&
      eligibleVaultAddresses.has(vault.underlyingAddress.toLowerCase())
  );
  if (canDepositBoth) return true;
  const heldKinds = new Set(
    vaults
      .filter((vault) => depositedAddresses.has(vault.address.toLowerCase()))
      .map((vault) => vault.kind)
  );
  return heldKinds.has('wrapper') && heldKinds.has('underlying');
}
