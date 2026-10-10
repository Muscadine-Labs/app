'use client';

import { useContext, useMemo, type ReactNode, createContext } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { useWallet } from '@/contexts/WalletContext';
import { ERC20_BALANCE_ABI } from '@/lib/abis';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { getLegacyVaultList } from '@/lib/vaults';
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

const LEGACY_VAULTS = getLegacyVaultList();

const ExplorerVaultsContext = createContext<ExplorerVaultsContextType | undefined>(undefined);

export function ExplorerVaultsProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const { eligibleVaultAddresses, isResolving } = useVaultDepositGates();

  // Legacy wrappers are listed only for holders. Read their balances on chain too, so a
  // holder still finds the exit when the Morpho positions API fails or lags.
  const { data: legacyBalances } = useReadContracts({
    allowFailure: true,
    contracts: address
      ? LEGACY_VAULTS.map((vault) => ({
          address: vault.address as `0x${string}`,
          chainId: BASE_CHAIN_ID,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf' as const,
          args: [address] as const,
        }))
      : [],
    query: { enabled: !!address },
  });

  const depositedAddresses = useMemo(() => {
    const held = getDepositedVaultAddressSet(morphoHoldings.positions);
    legacyBalances?.forEach((item, i) => {
      if (item.status === 'success' && (item.result as bigint) > BigInt(0)) {
        held.add(LEGACY_VAULTS[i].address.toLowerCase());
      }
    });
    return held;
  }, [morphoHoldings.positions, legacyBalances]);

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
