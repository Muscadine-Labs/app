/**
 * Canonical asset-decimal helpers for underlying vault/wallet tokens.
 * Prefer Morpho/API `assetDecimals` when available; fall back to symbol.
 */
export function getAssetDecimalsForSymbol(symbol: string): number {
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
  return getAssetDecimalsForSymbol(symbol);
}

/** Convert a human-readable token amount to raw integer string. */
export function tokenAmountToRaw(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
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
  // Values below 1e15 are human share counts; larger values are already raw wei.
  if (shares < 1e15) {
    return BigInt(Math.round(shares * 1e18)).toString();
  }
  return BigInt(Math.round(shares)).toString();
}
