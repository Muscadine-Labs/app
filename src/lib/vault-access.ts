import type { VaultKind } from '@/lib/vaults';
import { isUnderlyingVaultAddress } from '@/lib/vaults';

/** Underlying rows: live gate pass, or an existing share balance (exits). */
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
}): boolean {
  if (options.vaultKind !== 'underlying') return true;
  return options.eligibleUnderlyingAddresses.has(
    options.vaultAddress.toLowerCase()
  );
}

/** Native ETH wrap-and-deposit (Bundler3) is wrapper-only. */
export function allowsNativeEthVaultDeposit(vaultAddress: string): boolean {
  return !isUnderlyingVaultAddress(vaultAddress);
}

export function hasVisibleUnderlyingVaults(options: {
  eligibleUnderlyingAddresses: ReadonlySet<string>;
  depositedAddresses: ReadonlySet<string>;
}): boolean {
  if (options.eligibleUnderlyingAddresses.size > 0) return true;
  for (const address of options.depositedAddresses) {
    if (isUnderlyingVaultAddress(address)) return true;
  }
  return false;
}

/** Explorer kind tab default: underlying when gated in; wrappers when exit-only or public. */
export function getDefaultVaultKindFilter(options: {
  eligibleUnderlyingAddresses: ReadonlySet<string>;
  depositedAddresses: ReadonlySet<string>;
  /** Allowlisted depositor — avoids tab flash on refresh. */
  preferUnderlying?: boolean;
}): 'underlying' | 'wrappers' {
  if (options.preferUnderlying || options.eligibleUnderlyingAddresses.size > 0) {
    return 'underlying';
  }
  return 'wrappers';
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
}): UnderlyingVaultPageAccess {
  const key = options.vaultAddress.toLowerCase();
  if (options.eligibleUnderlyingAddresses.has(key)) return 'allowed';
  if (options.depositedAddresses.has(key)) return 'allowed';

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
