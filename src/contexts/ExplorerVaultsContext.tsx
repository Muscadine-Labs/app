'use client';

import { useContext, useEffect, useMemo, useState, type ReactNode, createContext } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { ERC20_BALANCE_ABI } from '@/lib/abis';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { getRegistryVaultList } from '@/lib/vaults';
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

/** Wrapper balances are also read on chain, so a holder still finds the exit when the Morpho positions API fails or lags. */
const WRAPPER_VAULTS = getRegistryVaultList().filter((vault) => vault.kind === 'wrapper');

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

  const { data: wrapperBalances, refetch: refetchWrapperBalances } = useReadContracts({
    allowFailure: true,
    contracts: address
      ? WRAPPER_VAULTS.map((vault) => ({
          address: vault.address as `0x${string}`,
          chainId: BASE_CHAIN_ID,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf' as const,
          args: [address] as const,
        }))
      : [],
    query: { enabled: !!address },
  });

  // Positions refresh after every transaction; re-read wrapper balances with them so a
  // full wrapper exit (or a new wrapper deposit) updates the list without a reload.
  useEffect(() => {
    if (address) void refetchWrapperBalances();
  }, [address, morphoHoldings.positions, refetchWrapperBalances]);

  const depositedAddresses = useMemo(() => {
    const held = getDepositedVaultAddressSet(morphoHoldings.positions);
    wrapperBalances?.forEach((item, i) => {
      if (item.status === 'success' && (item.result as bigint) > BigInt(0)) {
        held.add(WRAPPER_VAULTS[i].address.toLowerCase());
      }
    });
    return held;
  }, [morphoHoldings.positions, wrapperBalances]);

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
