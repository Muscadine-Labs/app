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
import { getRegistryVaultList } from '@/lib/vaults';

const REGISTRY_VAULTS = getRegistryVaultList();

interface ExplorerVaultsContextType {
  /** Registry vaults the explorer lists for this wallet. */
  explorerRegistryVaults: Vault[];
  /** Lowercase addresses of `explorerRegistryVaults`. A listed vault's page is viewable. */
  listedVaultAddresses: ReadonlySet<string>;
  /** Which contracts of each wrapper / underlying pair are listed. Session only; resets per wallet. */
  kindMode: VaultKindMode;
  setKindMode: (mode: VaultKindMode) => void;
  /**
   * The Advanced filter only matters when the wallet can deposit into both the wrapper and
   * the underlying of some vault, or holds at least one of each. Otherwise it is hidden and
   * the list stays on recommended.
   */
  canUseAdvanced: boolean;
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
  // Registry vault balances in morphoHoldings are read on chain (WalletContext), so a
  // holder still sees the vault when the Morpho positions API fails or lags.
  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const canUseAdvanced = useMemo(() => {
    const canDepositBoth = REGISTRY_VAULTS.some(
      (vault) =>
        vault.kind === 'wrapper' &&
        !!vault.underlyingAddress &&
        eligibleVaultAddresses.has(vault.address.toLowerCase()) &&
        eligibleVaultAddresses.has(vault.underlyingAddress.toLowerCase())
    );
    if (canDepositBoth) return true;
    const heldKinds = new Set(
      REGISTRY_VAULTS.filter((vault) => depositedAddresses.has(vault.address.toLowerCase())).map(
        (vault) => vault.kind
      )
    );
    return heldKinds.has('wrapper') && heldKinds.has('underlying');
  }, [eligibleVaultAddresses, depositedAddresses]);

  // Not stored: each wallet starts on the recommended list.
  const kindMode =
    canUseAdvanced && modeState.wallet === walletKey ? modeState.mode : 'recommended';

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
      canUseAdvanced,
      isResolving,
    }),
    [explorerRegistryVaults, listedVaultAddresses, kindMode, walletKey, canUseAdvanced, isResolving]
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
