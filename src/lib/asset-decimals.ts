/**
 * Canonical asset-decimal helpers for underlying vault/wallet tokens.
 * Prefer Morpho/API `assetDecimals` when available; fall back to symbol.
 */
export const DEFAULT_MORPHO_ASSET_DECIMALS = 6;
export const DEFAULT_MORPHO_ASSET_SYMBOL = 'USDC';

export function isUnknownAssetSymbol(symbol: string | undefined | null): boolean {
  if (!symbol) return true;
  const upper = symbol.trim().toUpperCase();
  return upper === '' || upper === 'UNKNOWN';
}

function inferSymbolFromShareToken(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  if (upper.includes('USDC')) return 'USDC';
  if (upper.includes('CBBTC') || upper.includes('CBTC')) return 'cbBTC';
  if (upper.includes('WETH') || upper === 'ETH') return 'WETH';
  return null;
}

function inferSymbolFromVaultName(name: string | undefined | null): string | null {
  if (!name) return null;
  const upper = name.toUpperCase();
  if (upper.includes('USDC')) return 'USDC';
  if (upper.includes('CBBTC') || upper.includes('CBTC')) return 'cbBTC';
  if (upper.includes('WETH')) return 'WETH';
  return null;
}

function inferSymbolFromDecimals(decimals: number | undefined | null): string {
  if (decimals === 8) return 'cbBTC';
  if (decimals === 18) return 'WETH';
  return DEFAULT_MORPHO_ASSET_SYMBOL;
}

/** Resolve underlying asset symbol from Morpho vault/position metadata. */
export function resolveMorphoAssetSymbol(options: {
  registrySymbol?: string | null;
  assetSymbol?: string | null;
  vaultSymbol?: string | null;
  assetDecimals?: number | null;
  vaultName?: string | null;
}): string {
  if (options.registrySymbol && !isUnknownAssetSymbol(options.registrySymbol)) {
    return options.registrySymbol;
  }
  if (options.assetSymbol && !isUnknownAssetSymbol(options.assetSymbol)) {
    return options.assetSymbol;
  }
  if (options.vaultSymbol && !isUnknownAssetSymbol(options.vaultSymbol)) {
    const fromShare = inferSymbolFromShareToken(options.vaultSymbol);
    if (fromShare) return fromShare;
    if (!options.vaultSymbol.startsWith('0x')) {
      return options.vaultSymbol;
    }
  }
  const fromName = inferSymbolFromVaultName(options.vaultName);
  if (fromName) return fromName;
  return inferSymbolFromDecimals(options.assetDecimals);
}

export function getAssetDecimalsForSymbol(symbol: string): number {
  if (isUnknownAssetSymbol(symbol)) return DEFAULT_MORPHO_ASSET_DECIMALS;
  const upper = symbol.toUpperCase();
  if (upper === 'USDC') return 6;
  if (upper === 'CBBTC' || upper === 'CBTC' || upper === 'BTC') return 8;
  return 18;
}

/** API decimals when present, otherwise symbol-based default. */
export function resolveAssetDecimals(
  symbol: string,
  fromApi?: number | null
): number {
  if (fromApi !== undefined && fromApi !== null && fromApi > 0) {
    return fromApi;
  }
  if (isUnknownAssetSymbol(symbol)) return DEFAULT_MORPHO_ASSET_DECIMALS;
  return getAssetDecimalsForSymbol(symbol);
}

/** Convert a human-readable token amount to raw integer string. */
export function tokenAmountToRaw(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const scaled = amount * 10 ** decimals;
  if (!Number.isFinite(scaled) || scaled <= 0) return '0';
  return BigInt(Math.trunc(scaled)).toString();
}

/**
 * Morpho GraphQL position fields (`assets`, `pnl`, etc.) are already in smallest-token units.
 */
export function morphoAmountToRaw(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '0';
  if (typeof amount === 'string') {
    const trimmed = amount.includes('.') ? amount.split('.')[0] : amount;
    if (!trimmed || trimmed === '0') return '0';
    try {
      return BigInt(trimmed).toString();
    } catch {
      return '0';
    }
  }
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return BigInt(Math.round(amount)).toString();
}

export function morphoAmountToDecimal(
  amount: number | string | null | undefined,
  decimals: number
): number {
  const raw = morphoAmountToRaw(amount);
  if (raw === '0') return 0;
  return Number(BigInt(raw)) / 10 ** decimals;
}

/** Morpho vault share balances are 18-decimal fixed-point integers (string or large number). */
export function normalizeMorphoShares(shares: number | string | null | undefined): string {
  if (shares === null || shares === undefined) return '0';
  if (typeof shares === 'string') {
    const trimmed = shares.includes('.') ? shares.split('.')[0] : shares;
    if (!trimmed || trimmed === '0') return '0';
    try {
      return BigInt(trimmed).toString();
    } catch {
      return '0';
    }
  }
  if (!Number.isFinite(shares) || shares <= 0) return '0';
  return BigInt(Math.trunc(shares)).toString();
}
