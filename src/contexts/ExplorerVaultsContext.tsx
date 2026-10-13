'use client';

import { useContext, useMemo, useState, type ReactNode, createContext } from 'react';
import { useAccount } from 'wagmi';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import {
  getDepositedVaultAddressSet,
  selectRegistryVaultsForExplorer,
  type VaultKindMode,
} from '@/lib/vault-utils';
import type { Vault } from '@/types/vault';

interface ExplorerVaultsContextType {
  /** Registry vaults the explorer lists for this wallet. */
  explorerRegistryVaults: Vault[];
  /** Lowercase addresses of `explorerRegistryVaults`. A listed vault's page is viewable. */
  listedVaultAddresses: ReadonlySet<string>;
  /** Which contracts of each wrapper / underlying pair are listed. Session only; resets per wallet. */
  kindMode: VaultKindMode;
  setKindMode: (mode: VaultKindMode) => void;
  /** Gate reads that decide the list are still loading. */
  isResolving: boolean;
}

const ExplorerVaultsContext = createContext<ExplorerVaultsContextType | undefined>(undefined);

export function ExplorerVaultsProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const { eligibleVaultAddresses, isResolving } = useVaultDepositGates();
  const walletKey = address?.toLowerCase() ?? null;
  const [modeState, setModeState] = useState<{ wallet: string | null; mode: VaultKindMode }>({
    wallet: null,
    mode: 'recommended',
  });
  // Not stored: each wallet starts on the recommended list.
  const kindMode = modeState.wallet === walletKey ? modeState.mode : 'recommended';

  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const explorerRegistryVaults = useMemo(
    () =>
      selectRegistryVaultsForExplorer({
        depositedAddresses,
        eligibleVaultAddresses,
        mode: kindMode,
      }),
    [depositedAddresses, eligibleVaultAddresses, kindMode]
  );

  const listedVaultAddresses = useMemo(
    () => new Set(explorerRegistryVaults.map((vault) => vault.address.toLowerCase())),
    [explorerRegistryVaults]
  );

  const value = useMemo(
    () => ({
      explorerRegistryVaults,
      listedVaultAddresses,
      kindMode,
      setKindMode: (mode: VaultKindMode) => setModeState({ wallet: walletKey, mode }),
      isResolving,
    }),
    [explorerRegistryVaults, listedVaultAddresses, kindMode, walletKey, isResolving]
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
