import { formatUnits } from 'viem';
import { TOKEN_ADDRESSES_LOWER, type TokenBalance } from '@/contexts/WalletContext';
import { VAULTS } from '@/lib/vaults';

/** Address-based token lookup for major Base assets (Alchemy symbol variants). */
export function findTokenBySymbol(
  symbol: string,
  tokenBalances: TokenBalance[]
): TokenBalance | undefined {
  if (symbol === 'cbBTC' || symbol === 'CBBTC') {
    return tokenBalances.find((t) => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.cbBTC);
  }
  if (symbol === 'USDC') {
    return tokenBalances.find((t) => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.USDC);
  }
  if (symbol === 'WETH') {
    return tokenBalances.find((t) => t.address.toLowerCase() === TOKEN_ADDRESSES_LOWER.WETH);
  }
  return tokenBalances.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
}

export function isWethVault(vaultAddress: string, symbol: string): boolean {
  return (
    symbol.toUpperCase() === 'WETH' ||
    vaultAddress.toLowerCase() === VAULTS.WETH_VAULT_V2.address.toLowerCase()
  );
}

export function isCbBtcVault(vaultAddress: string, symbol: string): boolean {
  return (
    symbol.toUpperCase() === 'CBBTC' ||
    vaultAddress.toLowerCase() === VAULTS.cbBTC_VAULT_V2.address.toLowerCase()
  );
}

export function getTokenBalanceAmount(
  symbol: string,
  tokenBalances: TokenBalance[]
): number {
  const token = findTokenBySymbol(symbol, tokenBalances);
  if (!token) return 0;
  return parseFloat(formatUnits(token.balance, token.decimals));
}
