const CHAIN_SLUG: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
};

/** Lowercase slug for Morpho market URLs (e.g. cbBTC + USDC → cbbtc-usdc). */
export function morphoMarketUrlSlug(collateralSymbol: string, loanSymbol: string): string {
  return `${collateralSymbol}-${loanSymbol}`.toLowerCase().replace(/\s+/g, '');
}

/** Display label: collateral / loan (e.g. cbBTC/USDC). */
export function formatMorphoMarketName(collateralSymbol: string, loanSymbol: string): string {
  return `${collateralSymbol}/${loanSymbol}`;
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
