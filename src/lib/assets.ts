import { formatUnits } from 'viem';
import { getVaultLogo, type Vault } from '@/types/vault';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';
import { BASE_CHAIN_ID } from '@/lib/constants';
import {
  createExternalVaultStub,
  findVaultByAddress,
  hasOnChainVaultShares,
  resolvePositionAssetsUsd,
  type WalletMorphoPosition,
} from '@/lib/vault-utils';
import { VAULTS, type VaultDefinition } from '@/lib/vaults';
import type { TokenBalance } from '@/contexts/WalletContext';

export type AssetSlug = 'usdc' | 'btc' | 'eth';

export interface AssetDefinition {
  slug: AssetSlug;
  /** Primary label in UI (ETH covers ETH + WETH; BTC covers cbBTC + optional BTC wrappers). */
  displaySymbol: string;
  name: string;
  decimals: number;
  /** Always listed in wallet breakdown (even at zero). */
  primaryLiquidSymbols: string[];
  /**
   * Extra wallet tokens that roll into this asset only when balance > dust.
   * Empty = none; BTC uses derivative matching instead.
   */
  optionalLiquidSymbols: string[];
  /** Vault underlying symbols that roll into this asset / vault list. */
  vaultSymbols: string[];
}

/** Known BTC wrappers beyond cbBTC — included only when held. */
export const BTC_OPTIONAL_LIQUID_SYMBOLS = [
  'LBTC',
  'kBTC',
  'KBTC',
  'WBTC',
  'tBTC',
  'TBTC',
  'BTC',
  'solvBTC',
  'SOLVBTC',
  'BTCB',
  'XBTC',
] as const;

const DUST_USD = 0.02;

export const ASSETS: Record<AssetSlug, AssetDefinition> = {
  usdc: {
    slug: 'usdc',
    displaySymbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    primaryLiquidSymbols: ['USDC'],
    optionalLiquidSymbols: [],
    vaultSymbols: ['USDC'],
  },
  btc: {
    slug: 'btc',
    displaySymbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    primaryLiquidSymbols: ['cbBTC'],
    optionalLiquidSymbols: [...BTC_OPTIONAL_LIQUID_SYMBOLS],
    vaultSymbols: [
      'cbBTC',
      'CBBTC',
      'CBTC',
      'BTC',
      'LBTC',
      'kBTC',
      'KBTC',
      'WBTC',
      'tBTC',
      'TBTC',
      'solvBTC',
      'SOLVBTC',
    ],
  },
  eth: {
    slug: 'eth',
    displaySymbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    primaryLiquidSymbols: ['ETH', 'WETH'],
    optionalLiquidSymbols: ['cbETH', 'wstETH'],
    vaultSymbols: ['WETH', 'ETH'],
  },
};

export const ASSET_SLUGS = Object.keys(ASSETS) as AssetSlug[];

/** Legacy slug aliases → current slug. */
const ASSET_SLUG_ALIASES: Record<string, AssetSlug> = {
  cbbtc: 'btc',
  bitcoin: 'btc',
  ether: 'eth',
  ethereum: 'eth',
};

export function getAssetBySlug(slug: string | undefined | null): AssetDefinition | null {
  if (!slug) return null;
  const key = slug.trim().toLowerCase();
  const resolved = (ASSET_SLUG_ALIASES[key] ?? key) as AssetSlug;
  return ASSETS[resolved] ?? null;
}

export function getAssetRoute(slug: string): string {
  const asset = getAssetBySlug(slug);
  return `/asset/${(asset?.slug ?? slug).toLowerCase()}`;
}

export function getAssetLogo(asset: AssetDefinition): string {
  return getVaultLogo(asset.displaySymbol);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function matchesSymbolSet(symbol: string, set: string[]): boolean {
  const upper = normalizeSymbol(symbol);
  return set.some((entry) => normalizeSymbol(entry) === upper);
}

/** Loose BTC-wrapper match for wallet discovery (e.g. FooBTC). */
export function isBtcDerivativeSymbol(symbol: string): boolean {
  const u = normalizeSymbol(symbol);
  if (!u || u === 'USDC' || u === 'USDT' || u === 'DAI') return false;
  if (matchesSymbolSet(u, ASSETS.btc.primaryLiquidSymbols)) return true;
  if (matchesSymbolSet(u, ASSETS.btc.optionalLiquidSymbols)) return true;
  if (matchesSymbolSet(u, ASSETS.btc.vaultSymbols)) return true;
  // e.g. somethingBTC / BTC.b — avoid matching short noise
  if (u.endsWith('BTC') && u.length >= 4 && u.length <= 12) return true;
  return false;
}

/**
 * Tokenized stock / equity wrappers (xStocks, etc.) — only shown when held.
 * Examples: AAPLx, TSLAx, xAAPL (exclude XETH/XBTC/XUSD).
 */
export function isStockLikeSymbol(symbol: string): boolean {
  const u = normalizeSymbol(symbol);
  if (!u) return false;
  if (u.includes('STOCK') || u.includes('EQUITY')) return true;
  if (u.includes('HOOD') && u.length <= 10) return true;

  // Stable / FX denomination tokens that end in X — not equity wrappers.
  const suffixXExcluded = new Set([
    'USDX',
    'EURX',
    'GBPX',
    'JPYX',
    'AUDX',
    'CADX',
    'CHFX',
    'PENDLEX',
  ]);

  // Suffix x: AAPLx, TSLAx, SPYx
  if (u.endsWith('X') && u.length >= 4 && u.length <= 7) {
    if (suffixXExcluded.has(u)) return false;
    const base = u.slice(0, -1);
    if (/^[A-Z]{1,5}$/.test(base)) return true;
  }

  // Prefix x: xAAPL (not XETH / XBTC / XUSD / XDAI)
  if (u.startsWith('X') && /^X[A-Z]{1,5}$/.test(u)) {
    const excluded = new Set(['XETH', 'XBTC', 'XUSD', 'XDAI', 'XUSDC']);
    if (!excluded.has(u)) return true;
  }

  return false;
}

export function findAssetForVaultSymbol(symbol: string | undefined | null): AssetDefinition | null {
  if (!symbol) return null;
  if (isBtcDerivativeSymbol(symbol)) return ASSETS.btc;
  for (const asset of Object.values(ASSETS)) {
    if (matchesSymbolSet(symbol, asset.vaultSymbols)) return asset;
  }
  return null;
}

export function getCuratedVaultsForAsset(asset: AssetDefinition): VaultDefinition[] {
  return Object.values(VAULTS).filter((vault) =>
    matchesSymbolSet(vault.symbol, asset.vaultSymbols)
  );
}

/**
 * Curated Muscadine vaults for the asset, plus any other Morpho vault positions
 * the user holds in that underlying (external included).
 */
export function getVaultsForAssetPage(
  asset: AssetDefinition,
  positions: WalletMorphoPosition[]
): Vault[] {
  const curated: Vault[] = getCuratedVaultsForAsset(asset).map((vault) => ({
    ...vault,
    isCurated: true,
  }));
  const seen = new Set(curated.map((vault) => vault.address.toLowerCase()));

  const fromPositions: Vault[] = [];
  for (const position of positions) {
    if (!hasOnChainVaultShares(position)) continue;
    const vaultSymbol = position.vault.symbol ?? '';
    const matches =
      asset.slug === 'btc'
        ? isBtcDerivativeSymbol(vaultSymbol) ||
          matchesSymbolSet(vaultSymbol, asset.vaultSymbols)
        : matchesSymbolSet(vaultSymbol, asset.vaultSymbols);
    if (!matches) continue;

    const address = position.vault.address;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const registry = findVaultByAddress(address);
    if (registry) {
      fromPositions.push({ ...registry, isCurated: true });
      continue;
    }

    fromPositions.push(
      createExternalVaultStub(address, {
        name: position.vault.name,
        symbol: position.vault.symbol || asset.displaySymbol,
        chainId: BASE_CHAIN_ID,
      })
    );
  }

  return [...curated, ...fromPositions];
}

export interface AssetLiquidPart {
  symbol: string;
  amount: number;
  usd: number;
  raw: bigint;
  decimals: number;
}

export interface AssetVaultPart {
  address: string;
  name: string;
  symbol: string;
  amount: number;
  usd: number;
  raw: bigint;
  decimals: number;
  isCurated: boolean;
}

export interface AssetHolding {
  asset: AssetDefinition;
  logo: string;
  liquidParts: AssetLiquidPart[];
  liquidAmount: number;
  liquidUsd: number;
  liquidRaw: bigint;
  vaultParts: AssetVaultPart[];
  vaultAmount: number;
  vaultUsd: number;
  vaultRaw: bigint;
  totalAmount: number;
  totalUsd: number;
  totalRaw: bigint;
  /** Spot price inferred from holdings when possible. */
  priceUsd: number;
}

export interface StockHolding {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  amount: number;
  usd: number;
  raw: bigint;
}

function rawToAmount(raw: bigint, decimals: number): number {
  try {
    return Number(formatUnits(raw, decimals));
  } catch {
    return 0;
  }
}

/** Scale a raw amount from one decimal precision to another (floor). */
function scaleRawToDecimals(raw: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (raw === BigInt(0) || fromDecimals === toDecimals) return raw;
  if (fromDecimals < toDecimals) {
    return raw * BigInt(10) ** BigInt(toDecimals - fromDecimals);
  }
  return raw / BigInt(10) ** BigInt(fromDecimals - toDecimals);
}

function parsePositionRaw(position: WalletMorphoPosition, decimals: number): bigint {
  if (!position.assets) return BigInt(0);
  try {
    return BigInt(position.assets);
  } catch {
    const asNumber = Number(position.assets);
    if (!Number.isFinite(asNumber) || asNumber <= 0) return BigInt(0);
    try {
      return BigInt(Math.round(asNumber * 10 ** decimals));
    } catch {
      return BigInt(0);
    }
  }
}

function resolvePositionDecimals(position: WalletMorphoPosition, symbol: string): number {
  if (position.assetDecimals && position.assetDecimals > 0) {
    return position.assetDecimals;
  }
  return getAssetDecimalsForSymbol(symbol);
}

function sumLiquidForSymbol(
  symbol: string,
  tokenBalances: TokenBalance[],
  displaySymbol?: string
): AssetLiquidPart {
  const decimals = getAssetDecimalsForSymbol(symbol);
  const matches = tokenBalances.filter(
    (token) => normalizeSymbol(token.symbol) === normalizeSymbol(symbol)
  );

  let raw = BigInt(0);
  let usd = 0;
  let resolvedDecimals = decimals;
  for (const token of matches) {
    raw += token.balance;
    usd += token.usdValue;
    if (token.decimals > 0) resolvedDecimals = token.decimals;
  }

  return {
    symbol: displaySymbol ?? symbol,
    amount: rawToAmount(raw, resolvedDecimals),
    usd,
    raw,
    decimals: resolvedDecimals,
  };
}

function primaryDisplaySymbol(walletSymbol: string, asset: AssetDefinition): string {
  if (asset.slug === 'btc' && normalizeSymbol(walletSymbol) === 'CBBTC') {
    return 'BTC';
  }
  return walletSymbol;
}

function collectOptionalLiquidParts(
  asset: AssetDefinition,
  tokenBalances: TokenBalance[],
  alreadyUsed: Set<string>
): AssetLiquidPart[] {
  const parts: AssetLiquidPart[] = [];

  const consider = (token: TokenBalance) => {
    const key = normalizeSymbol(token.symbol);
    if (alreadyUsed.has(key)) return;
    if (token.balance <= BigInt(0) || token.usdValue <= DUST_USD) return;

    alreadyUsed.add(key);
    parts.push({
      symbol: token.symbol,
      amount: rawToAmount(token.balance, token.decimals),
      usd: token.usdValue,
      raw: token.balance,
      decimals: token.decimals,
    });
  };

  if (asset.slug === 'btc') {
    for (const token of tokenBalances) {
      if (!isBtcDerivativeSymbol(token.symbol)) continue;
      // Skip primary cbBTC — already in primary list
      if (normalizeSymbol(token.symbol) === 'CBBTC') continue;
      consider(token);
    }
    return parts.sort((a, b) => b.usd - a.usd);
  }

  for (const symbol of asset.optionalLiquidSymbols) {
    const token = tokenBalances.find(
      (t) => normalizeSymbol(t.symbol) === normalizeSymbol(symbol)
    );
    if (!token) continue;
    consider(token);
  }

  return parts.sort((a, b) => b.usd - a.usd);
}

function positionMatchesAsset(
  position: WalletMorphoPosition,
  asset: AssetDefinition
): boolean {
  const symbol = position.vault.symbol ?? '';
  if (asset.slug === 'btc') {
    return (
      isBtcDerivativeSymbol(symbol) || matchesSymbolSet(symbol, asset.vaultSymbols)
    );
  }
  return matchesSymbolSet(symbol, asset.vaultSymbols);
}

/** Build combined wallet + vault holdings for a curated asset family. */
export function buildAssetHolding(
  asset: AssetDefinition,
  tokenBalances: TokenBalance[],
  positions: WalletMorphoPosition[]
): AssetHolding {
  const usedSymbols = new Set<string>();
  const primaryParts = asset.primaryLiquidSymbols.map((symbol) => {
    usedSymbols.add(normalizeSymbol(symbol));
    return sumLiquidForSymbol(
      symbol,
      tokenBalances,
      primaryDisplaySymbol(symbol, asset)
    );
  });

  const optionalParts = collectOptionalLiquidParts(asset, tokenBalances, usedSymbols);
  const liquidParts = [...primaryParts, ...optionalParts];

  const liquidAmount = liquidParts.reduce((sum, part) => sum + part.amount, 0);
  const liquidUsd = liquidParts.reduce((sum, part) => sum + part.usd, 0);

  const vaultParts: AssetVaultPart[] = positions
    .filter(
      (position) =>
        hasOnChainVaultShares(position) && positionMatchesAsset(position, asset)
    )
    .map((position) => {
      const symbol = position.vault.symbol || asset.displaySymbol;
      const decimals = resolvePositionDecimals(position, symbol);
      const raw = parsePositionRaw(position, decimals);
      const usd = resolvePositionAssetsUsd(position, {
        assetDecimals: decimals,
        symbol,
      });
      return {
        address: position.vault.address,
        name: position.vault.name || 'Vault',
        symbol,
        amount: rawToAmount(raw, decimals),
        usd,
        raw,
        decimals,
        isCurated: position.vault.isCurated !== false,
      };
    })
    .sort((a, b) => b.usd - a.usd);

  const vaultAmount = vaultParts.reduce((sum, part) => sum + part.amount, 0);
  const vaultUsd = vaultParts.reduce((sum, part) => sum + part.usd, 0);
  const liquidRaw = liquidParts.reduce(
    (sum, part) => sum + scaleRawToDecimals(part.raw, part.decimals, asset.decimals),
    BigInt(0)
  );
  const vaultRaw = vaultParts.reduce(
    (sum, part) => sum + scaleRawToDecimals(part.raw, part.decimals, asset.decimals),
    BigInt(0)
  );
  const totalRaw = liquidRaw + vaultRaw;
  const totalAmount = liquidAmount + vaultAmount;
  const totalUsd = liquidUsd + vaultUsd;

  let priceUsd = 0;
  if (totalAmount > 0 && totalUsd > 0) {
    priceUsd = totalUsd / totalAmount;
  } else if (liquidAmount > 0 && liquidUsd > 0) {
    priceUsd = liquidUsd / liquidAmount;
  } else if (asset.slug === 'usdc') {
    priceUsd = 1;
  }

  return {
    asset,
    logo: getAssetLogo(asset),
    liquidParts,
    liquidAmount,
    liquidUsd,
    liquidRaw,
    vaultParts,
    vaultAmount,
    vaultUsd,
    vaultRaw,
    totalAmount,
    totalUsd,
    totalRaw,
    priceUsd,
  };
}

/**
 * Curated families for the Tokens panel — only when wallet holds the asset
 * (or a derivative) and/or has a vault position above dust (~$0.02).
 */
export function buildDashboardAssetHoldings(
  tokenBalances: TokenBalance[],
  positions: WalletMorphoPosition[]
): AssetHolding[] {
  return ASSET_SLUGS.map((slug) =>
    buildAssetHolding(ASSETS[slug], tokenBalances, positions)
  )
    .filter(
      (holding) =>
        holding.totalUsd > DUST_USD || holding.vaultParts.length > 0
    )
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

/** Stock-like tokens currently in the wallet (only if held). */
export function buildStockHoldings(tokenBalances: TokenBalance[]): StockHolding[] {
  return tokenBalances
    .filter(
      (token) =>
        isStockLikeSymbol(token.symbol) &&
        token.balance > BigInt(0) &&
        token.usdValue > DUST_USD
    )
    .map((token) => ({
      symbol: token.symbol,
      name: token.symbol,
      address: token.address,
      decimals: token.decimals,
      amount: rawToAmount(token.balance, token.decimals),
      usd: token.usdValue,
      raw: token.balance,
    }))
    .sort((a, b) => b.usd - a.usd);
}

export interface WalletOnlyTokenHolding {
  symbol: string;
  address: string;
  decimals: number;
  amount: number;
  usd: number;
  raw: bigint;
}

/** True if symbol is already represented by USDC / BTC / ETH families or Stocks. */
export function isCoveredByCuratedAssetFamily(symbol: string): boolean {
  if (isStockLikeSymbol(symbol)) return true;
  if (isBtcDerivativeSymbol(symbol)) return true;
  for (const asset of Object.values(ASSETS)) {
    if (matchesSymbolSet(symbol, asset.primaryLiquidSymbols)) return true;
    if (matchesSymbolSet(symbol, asset.optionalLiquidSymbols)) return true;
    if (matchesSymbolSet(symbol, asset.vaultSymbols)) return true;
  }
  return false;
}

/**
 * Other wallet tokens (AERO, etc.) not in USDC/BTC/ETH families or Stocks.
 * Shown on Tokens only when held — no asset page / vaults required.
 */
export function buildExtraWalletTokenHoldings(
  tokenBalances: TokenBalance[]
): WalletOnlyTokenHolding[] {
  return tokenBalances
    .filter(
      (token) =>
        token.balance > BigInt(0) &&
        token.usdValue > DUST_USD &&
        !isCoveredByCuratedAssetFamily(token.symbol)
    )
    .map((token) => ({
      symbol: token.symbol,
      address: token.address,
      decimals: token.decimals,
      amount: rawToAmount(token.balance, token.decimals),
      usd: token.usdValue,
      raw: token.balance,
    }))
    .sort((a, b) => b.usd - a.usd);
}
