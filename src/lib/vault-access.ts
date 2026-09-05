import { type Address, getAddress, zeroAddress } from 'viem';
import type { VaultKind } from '@/lib/vaults';
import { isUnderlyingVaultAddress } from '@/lib/vaults';

/**
 * True when the connected wallet may deposit into a gated underlying vault.
 * `canSendAssets` is true while no gate is set — treat that as closed for UI.
 */
export function isEligibleToDepositToUnderlying(
  sendAssetsGate: Address | string | null | undefined,
  canSendAssets: boolean | undefined
): boolean {
  if (!sendAssetsGate) return false;
  try {
    if (getAddress(sendAssetsGate) === zeroAddress) return false;
  } catch {
    return false;
  }
  return canSendAssets === true;
}

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
  accessLoading: boolean;
}): boolean {
  if (options.vaultKind !== 'underlying') return true;
  if (options.accessLoading) return false;
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
}): 'underlying' | 'wrappers' {
  if (options.eligibleUnderlyingAddresses.size > 0) return 'underlying';
  return 'wrappers';
}
