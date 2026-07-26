const CHAIN_SLUG: Record<number, string> = {
  8453: 'base',
};

/** Lowercase slug for Morpho market URLs (e.g. cbBTC + USDC → cbbtc-usdc). */
export function morphoMarketUrlSlug(collateralSymbol: string, loanSymbol: string): string {
  return `${collateralSymbol}-${loanSymbol}`.toLowerCase().replace(/\s+/g, '');
}

/** Morpho LLTV raw (1e18 scale) → percent string with one decimal (e.g. "77.0"). */
export function formatMorphoMarketLltvPercent(
  lltv: number | string | null | undefined
): string | null {
  if (lltv == null) return null;
  try {
    const raw =
      typeof lltv === 'string'
        ? BigInt(lltv.includes('.') ? lltv.split('.')[0] : lltv)
        : BigInt(Math.round(lltv));
    const pct = Number(raw) / 1e18 * 100;
    if (!Number.isFinite(pct)) return null;
    return pct.toFixed(1);
  } catch {
    return null;
  }
}

export type MorphoMarketRateType = 'variable' | 'fixed';

/** Display label: collateral / loan (e.g. cbBTC/USDC). */
export function formatMorphoMarketName(
  collateralSymbol: string,
  loanSymbol: string
): string {
  return `${collateralSymbol}/${loanSymbol}`;
}

/** e.g. Variable (77.0%) or Fixed (62.5%). */
export function formatMorphoMarketRateLabel(
  rateType: MorphoMarketRateType | null | undefined,
  lltv: number | string | null | undefined
): string | null {
  if (!rateType) return null;
  const lltvPct = formatMorphoMarketLltvPercent(lltv);
  const kind = rateType === 'fixed' ? 'Fixed' : 'Variable';
  return lltvPct != null ? `${kind} (${lltvPct}%)` : kind;
}

export function getMorphoMarketUrl(
  chainId: number,
  marketId: string,
  collateralSymbol: string,
  loanSymbol: string
): string {
  const network = CHAIN_SLUG[chainId] ?? 'base';
  const slug = morphoMarketUrlSlug(collateralSymbol, loanSymbol);
  return `https://app.morpho.org/${network}/variable/${marketId}/${slug}#market`;
}
