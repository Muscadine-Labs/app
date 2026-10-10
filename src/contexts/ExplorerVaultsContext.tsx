'use client';

import { useContext, useMemo, type ReactNode, createContext } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import {
  getDepositedVaultAddressSet,
  selectRegistryVaultsForExplorer,
} from '@/lib/vault-utils';
import type { Vault } from '@/types/vault';

interface ExplorerVaultsContextType {
  /** Registry vaults the explorer lists for this wallet. */
  explorerRegistryVaults: Vault[];
  /** Gate reads that decide the list are still loading. */
  isResolving: boolean;
}

const ExplorerVaultsContext = createContext<ExplorerVaultsContextType | undefined>(undefined);

export function ExplorerVaultsProvider({ children }: { children: ReactNode }) {
  const { morphoHoldings } = useWallet();
  const { eligibleVaultAddresses, isResolving } = useVaultDepositGates();

  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const explorerRegistryVaults = useMemo(
    () =>
      selectRegistryVaultsForExplorer({
        depositedAddresses,
        eligibleVaultAddresses,
      }),
    [depositedAddresses, eligibleVaultAddresses]
  );

  const value = useMemo(
    () => ({
      explorerRegistryVaults,
      isResolving,
    }),
    [explorerRegistryVaults, isResolving]
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
