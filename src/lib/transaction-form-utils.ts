import type { TokenBalance } from '@/contexts/WalletContext';
import { tokenMetadataForSymbol } from '@/lib/token-metadata';
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

/** Token lookup by address when the symbol is a known registry asset, else by symbol. */
export function findTokenBySymbol(
  symbol: string,
  tokenBalances: TokenBalance[]
): TokenBalance | undefined {
  if (symbol === 'ETH') {
    return tokenBalances.find((t) => t.address === 'ETH');
  }
  const known = tokenMetadataForSymbol(symbol);
  if (known) {
    const byAddress = tokenBalances.find(
      (t) => t.address.toLowerCase() === known.address.toLowerCase()
    );
    if (byAddress) return byAddress;
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
