/**
 * Token metadata learned at runtime: each registry vault's asset (read on chain) and its
 * logo (from Morpho). Symbol-based helpers (`getAssetDecimalsForSymbol`, `getVaultLogo`)
 * check here first, so a vault in any token formats and renders without a hardcoded entry.
 */
export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
}

const bySymbol = new Map<string, TokenMetadata>();
const byAddress = new Map<string, TokenMetadata>();
const logosByAddress = new Map<string, string>();

function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** Register a token under its address and each given symbol (on-chain and registry label). */
export function registerTokenMetadata(token: TokenMetadata, aliases: readonly string[] = []): void {
  byAddress.set(token.address.toLowerCase(), token);
  for (const symbol of [token.symbol, ...aliases]) {
    if (symbol.trim()) bySymbol.set(symbolKey(symbol), token);
  }
}

export function tokenMetadataForSymbol(symbol: string | null | undefined): TokenMetadata | null {
  if (!symbol) return null;
  return bySymbol.get(symbolKey(symbol)) ?? null;
}

export function tokenMetadataForAddress(address: string | null | undefined): TokenMetadata | null {
  if (!address) return null;
  return byAddress.get(address.toLowerCase()) ?? null;
}

export function registerTokenLogo(address: string, logoURI: string): void {
  if (/^https:\/\//.test(logoURI)) logosByAddress.set(address.toLowerCase(), logoURI);
}

/** Morpho logo for a registered token symbol, when one was loaded. */
export function tokenLogoForSymbol(symbol: string | null | undefined): string | null {
  const token = tokenMetadataForSymbol(symbol);
  return token ? logosByAddress.get(token.address.toLowerCase()) ?? null : null;
}

/** Test helper. */
export function resetTokenMetadataForTests(): void {
  bySymbol.clear();
  byAddress.clear();
  logosByAddress.clear();
}
