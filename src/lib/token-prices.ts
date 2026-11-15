import { getAddress, isAddress } from 'viem';

/** Most tokens one price request may ask for. */
export const MAX_PRICE_ADDRESSES = 50;

/** Parse `?addresses=` into unique, checksummed Base token addresses (invalid ones dropped). */
export function parsePriceAddresses(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!isAddress(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(getAddress(value));
    if (out.length >= MAX_PRICE_ADDRESSES) break;
  }
  return out;
}

export interface MorphoPricedAsset {
  address?: string | null;
  logoURI?: string | null;
  price?: { usd?: number | null } | null;
}

export interface TokenPriceResponse {
  /** Lowercase address → USD price. Tokens Morpho does not price are left out. */
  prices: Record<string, number>;
  /** Lowercase address → Morpho logo URL. */
  logos: Record<string, string>;
}

/** Keep finite positive prices and https logos, keyed by lowercase address. */
export function mapMorphoAssetPrices(items: readonly MorphoPricedAsset[]): TokenPriceResponse {
  const prices: Record<string, number> = {};
  const logos: Record<string, string> = {};
  for (const item of items) {
    if (!item?.address || !isAddress(item.address)) continue;
    const key = item.address.toLowerCase();
    const usd = item.price?.usd;
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) prices[key] = usd;
    if (typeof item.logoURI === 'string' && item.logoURI.startsWith('https://')) {
      logos[key] = item.logoURI;
    }
  }
  return { prices, logos };
}
