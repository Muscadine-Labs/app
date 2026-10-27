'use client';

import { findVaultByAddress, getDepositedVaultAddressSet, getVaultRoute } from '@/lib/vault-utils';
import { getMorphoVaultUrl } from '@/lib/liquidity-utils';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useExplorerVaults } from '@/contexts/ExplorerVaultsContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import { useWallet } from '@/contexts/WalletContext';

export interface VaultPageHref {
  href: string;
  /** True for the in-app vault page, false for the vault on Morpho. */
  internal: boolean;
}

/**
 * In-app link when the wallet can open the vault's page, else the vault on Morpho.
 * A wallet that cannot open the page would be redirected to `/vaults`.
 */
export function useVaultPageHref(): (vaultAddress: string) => VaultPageHref {
  const { listedVaultAddresses } = useExplorerVaults();
  const { eligibleVaultAddresses } = useVaultDepositGates();
  const { morphoHoldings } = useWallet();
  return (vaultAddress: string) => {
    const key = vaultAddress.toLowerCase();
    // Same rule as the vault page's access check: listed, depositable, or held.
    const pageOpen =
      !!findVaultByAddress(vaultAddress) &&
      (listedVaultAddresses.has(key) ||
        eligibleVaultAddresses.has(key) ||
        getDepositedVaultAddressSet(morphoHoldings.positions).has(key));
    return pageOpen
      ? { href: getVaultRoute(vaultAddress), internal: true }
      : { href: getMorphoVaultUrl(BASE_CHAIN_ID, vaultAddress), internal: false };
  };
}
