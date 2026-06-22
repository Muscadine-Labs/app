/**
 * Read-only v1 MetaMorpho addresses for portfolio history (migrated users).
 * Not in the active registry — withdrawals only; used to backfill pre-v2 charts.
 */
export const LEGACY_V1_VAULT_BY_SYMBOL: Record<
  string,
  { address: string; symbol: string }
> = {
  USDC: {
    address: '0xf7e26Fa48A568b8b0038e104DfD8ABdf0f99074F',
    symbol: 'USDC',
  },
  CBBTC: {
    address: '0xAeCc8113a7bD0CFAF7000EA7A31afFD4691ff3E9',
    symbol: 'cbBTC',
  },
  WETH: {
    address: '0x21e0d366272798da3A977FEBA699FCB91959d120',
    symbol: 'WETH',
  },
};

export function normalizePortfolioAssetSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper === 'CBBTC' || upper === 'CBTC' || upper === 'BTC') return 'CBBTC';
  if (upper === 'WETH' || upper === 'ETH') return 'WETH';
  if (upper === 'USDC') return 'USDC';
  return upper;
}

export function getLegacyV1VaultForSymbol(symbol: string) {
  return LEGACY_V1_VAULT_BY_SYMBOL[normalizePortfolioAssetSymbol(symbol)];
}

export function isLegacyMuscadineV1Vault(address: string): boolean {
  const lower = address.toLowerCase();
  return Object.values(LEGACY_V1_VAULT_BY_SYMBOL).some(
    (v) => v.address.toLowerCase() === lower
  );
}
