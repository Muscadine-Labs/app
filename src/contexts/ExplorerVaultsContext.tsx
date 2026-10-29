'use client';

import { useContext, useMemo, type ReactNode, createContext } from 'react';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import { getPartnerVaultAddresses } from '@/lib/partner-vaults';
import { getAllRegistryVaults } from '@/lib/vault-utils';
import type { Vault } from '@/types/vault';

interface ExplorerVaultsContextType {
  /** Registry vaults the explorer lists: every vault, view-only when the wallet cannot deposit. */
  explorerRegistryVaults: Vault[];
  /** Lowercase addresses of `explorerRegistryVaults`. A listed vault's page is viewable. */
  listedVaultAddresses: ReadonlySet<string>;
  /** Gate reads that decide deposit access are still loading. */
  isResolving: boolean;
}

const ExplorerVaultsContext = createContext<ExplorerVaultsContextType | undefined>(undefined);

const REGISTRY_VAULTS = getAllRegistryVaults();
const REGISTRY_VAULT_ADDRESSES: ReadonlySet<string> = new Set([
  ...REGISTRY_VAULTS.map((vault) => vault.address.toLowerCase()),
  ...getPartnerVaultAddresses().map((address) => address.toLowerCase()),
]);

export function ExplorerVaultsProvider({ children }: { children: ReactNode }) {
  const { isResolving } = useVaultDepositGates();

  const value = useMemo(
    () => ({
      explorerRegistryVaults: REGISTRY_VAULTS,
      listedVaultAddresses: REGISTRY_VAULT_ADDRESSES,
      isResolving,
    }),
    [isResolving]
  );

  return (
    <ExplorerVaultsContext.Provider value={value}>{children}</ExplorerVaultsContext.Provider>
  );
}

export function useExplorerVaults() {
  const context = useContext(ExplorerVaultsContext);
  if (!context) {
    throw new Error('useExplorerVaults must be used within an ExplorerVaultsProvider');
  }
  return context;
}
