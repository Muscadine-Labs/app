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
  const address = token.address.toLowerCase();
  byAddress.set(address, token);
  if (token.symbol.trim()) bySymbol.set(symbolKey(token.symbol), token);
  // A registry label is an extra name only when no other token already holds it: a row copied
  // with the wrong label must not give another token's decimals to a symbol lookup.
  for (const alias of aliases) {
    if (!alias.trim()) continue;
    const held = bySymbol.get(symbolKey(alias));
    if (!held || held.address.toLowerCase() === address) bySymbol.set(symbolKey(alias), token);
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

/** Logos are drawn with `next/image`, which only loads hosts listed in next.config.ts. */
const ALLOWED_LOGO_PREFIX = 'https://cdn.morpho.org/';

export function registerTokenLogo(address: string, logoURI: string): void {
  if (logoURI.startsWith(ALLOWED_LOGO_PREFIX)) logosByAddress.set(address.toLowerCase(), logoURI);
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
