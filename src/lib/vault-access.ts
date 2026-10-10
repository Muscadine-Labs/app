/** Rows and pages: the vault's gate lets this wallet deposit, or it holds shares (exits). */
export function isRegistryVaultVisible(options: {
  vaultAddress: string;
  eligibleVaultAddresses: ReadonlySet<string>;
  depositedAddresses: ReadonlySet<string>;
}): boolean {
  const key = options.vaultAddress.toLowerCase();
  return (
    options.eligibleVaultAddresses.has(key) ||
    options.depositedAddresses.has(key)
  );
}

export function canDepositToVault(options: {
  vaultAddress: string;
  eligibleVaultAddresses: ReadonlySet<string>;
}): boolean {
  return options.eligibleVaultAddresses.has(options.vaultAddress.toLowerCase());
}

export type VaultPageAccess = 'allowed' | 'pending' | 'denied';

/** Vault detail page — allow depositors and exit holders; redirect everyone else. */
export function resolveVaultPageAccess(options: {
  vaultAddress: string;
  eligibleVaultAddresses: ReadonlySet<string>;
  depositedAddresses: ReadonlySet<string>;
  walletStatus: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  walletAddress?: string | null;
  positionsResolvedFor: string | null;
  /** Vault gate reads are still loading. */
  gatesResolving: boolean;
}): VaultPageAccess {
  const key = options.vaultAddress.toLowerCase();
  if (options.eligibleVaultAddresses.has(key)) return 'allowed';
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
