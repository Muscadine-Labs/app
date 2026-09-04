import { TOKEN_ADDRESSES_LOWER, type TokenBalance } from '@/contexts/WalletContext';
import { findVaultByAddress } from '@/lib/vault-utils';
import type { Account } from '@/types/vault';

export type TransactionTab = 'deposit' | 'withdraw';

/** True when from/to match the selected deposit or withdraw tab layout. */
export function accountsMatchTransactionTab(
  tab: TransactionTab,
  from: Account | null,
  to: Account | null
): boolean {
  if (tab === 'deposit') {
    return from?.type === 'wallet' && (to === null || to.type === 'vault');
  }
  return from?.type === 'vault' && to?.type === 'wallet';
}

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
  if (symbol === 'ETH') {
    return tokenBalances.find((t) => t.address === 'ETH');
  }
  return tokenBalances.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
}

export function isWethVault(vaultAddress: string, symbol: string): boolean {
  const registry = findVaultByAddress(vaultAddress);
  if (registry) return registry.symbol === 'WETH';
  return symbol.toUpperCase() === 'WETH';
}

export function getTokenBalanceRaw(
  symbol: string,
  tokenBalances: TokenBalance[]
): bigint {
  const token = findTokenBySymbol(symbol, tokenBalances);
  return token?.balance ?? BigInt(0);
}
