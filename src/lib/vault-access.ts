import type { VaultKind } from '@/lib/vaults';
import { isUnderlyingVaultAddress } from '@/lib/vaults';

/** Underlying rows: the vault's gate lets this wallet deposit, or it holds shares (exits). */
export function isUnderlyingVisible(options: {
  vaultKind: VaultKind | undefined;
  vaultAddress: string;
  eligibleUnderlyingAddresses: ReadonlySet<string>;
  depositedAddresses: ReadonlySet<string>;
}): boolean {
  if (options.vaultKind !== 'underlying') return true;
  const key = options.vaultAddress.toLowerCase();
  return (
    options.eligibleUnderlyingAddresses.has(key) ||
    options.depositedAddresses.has(key)
  );
}

export function canDepositToVault(options: {
  vaultKind: VaultKind | undefined;
  vaultAddress: string;
  eligibleUnderlyingAddresses: ReadonlySet<string>;
  /** The wrapper's gate or its liquidity adapter blocks deposits. Withdraw stays open. */
  wrapperDepositBlocked?: boolean;
}): boolean {
  if (options.vaultKind === 'wrapper') return !options.wrapperDepositBlocked;
  if (options.vaultKind !== 'underlying') return true;
  return options.eligibleUnderlyingAddresses.has(
    options.vaultAddress.toLowerCase()
  );
}

/**
 * Native ETH wrap-and-deposit (Bundler3) fallback when the vault gate read fails:
 * wrappers only, since GeneralAdapter1 is not on the underlying allowlist.
 */
export function allowsNativeEthVaultDeposit(vaultAddress: string): boolean {
  return !isUnderlyingVaultAddress(vaultAddress);
}

export type UnderlyingVaultPageAccess = 'allowed' | 'pending' | 'denied';

/** Underlying vault detail page — allow depositors + exit holders; redirect everyone else. */
export function resolveUnderlyingVaultPageAccess(options: {
  vaultAddress: string;
  eligibleUnderlyingAddresses: ReadonlySet<string>;
  depositedAddresses: ReadonlySet<string>;
  walletStatus: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  walletAddress?: string | null;
  positionsResolvedFor: string | null;
  /** Vault gate reads are still loading. */
  gatesResolving: boolean;
}): UnderlyingVaultPageAccess {
  const key = options.vaultAddress.toLowerCase();
  if (options.eligibleUnderlyingAddresses.has(key)) return 'allowed';
  if (options.depositedAddresses.has(key)) return 'allowed';
  if (options.gatesResolving) return 'pending';

  if (
    options.walletStatus === 'connecting' ||
    options.walletStatus === 'reconnecting'
  ) {
    return 'pending';
  }

  if (options.walletStatus === 'connected') {
    const wallet = options.walletAddress?.toLowerCase();
    const resolved = options.positionsResolvedFor?.toLowerCase();
    if (!wallet || !resolved || resolved !== wallet) {
      return 'pending';
    }
  }

  return 'denied';
}
