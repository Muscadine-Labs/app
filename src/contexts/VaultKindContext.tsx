'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAccount } from 'wagmi';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import {
  getDepositedVaultAddressSet,
  resolveVaultKindFilter,
  selectRegistryVaultsForExplorer,
  selectVaultKindMarkAddresses,
} from '@/lib/vault-utils';
import { isUnderlyingVaultAddress } from '@/lib/vaults';
import type { Vault } from '@/types/vault';

/** Removed. The switch is not stored; each visit opens on the default list. */
const LEGACY_STORAGE_KEY = 'vault-explorer-kind-filter';

const NO_ADDRESSES: ReadonlySet<string> = new Set();

export type VaultSurface = 'wrappers' | 'underlying';

interface VaultKindContextType {
  kindFilter: VaultSurface;
  setKindFilter: (kind: VaultSurface) => void;
  /**
   * Settings switch. Whitelisted wallets deposit in both lists; wallets that only
   * hold underlying shares view that list with deposits blocked and withdrawals open.
   * Hidden when every wrapper is blocked.
   */
  canSwitchKinds: boolean;
  /** Registry vaults the explorer lists for this wallet and kind. */
  explorerRegistryVaults: Vault[];
  /** Vaults that get a wrapper / underlying pill because the list mixes kinds. */
  kindMarkAddresses: ReadonlySet<string>;
  /** Gate reads that decide the list are still loading. */
  isResolving: boolean;
}

const VaultKindContext = createContext<VaultKindContextType | undefined>(undefined);

export function VaultKindProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();
  const {
    eligibleUnderlyingAddresses,
    canDepositEveryUnderlying,
    wrappersAcceptDeposits,
    isResolving,
  } = useVaultDepositGates();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [overrideKind, setOverrideKind] = useState<VaultSurface | null>(null);

  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );
  const holdsUnderlying = useMemo(
    () => [...depositedAddresses].some(isUnderlyingVaultAddress),
    [depositedAddresses]
  );

  const addressKey = address?.toLowerCase() ?? null;
  if (addressKey !== sessionAddress) {
    setSessionAddress(addressKey);
    setOverrideKind(null);
  }
  const manualKind = addressKey === sessionAddress ? overrideKind : null;

  const { kindFilter, canSwitchKinds } = resolveVaultKindFilter({
    canDepositEveryUnderlying,
    wrappersAcceptDeposits,
    holdsUnderlying,
    manualKind,
  });

  const explorerRegistryVaults = useMemo(
    () =>
      selectRegistryVaultsForExplorer({
        kindFilter,
        depositedAddresses,
        eligibleUnderlyingAddresses,
        wrapperListUnderlyingAddresses: canDepositEveryUnderlying
          ? NO_ADDRESSES
          : eligibleUnderlyingAddresses,
      }),
    [kindFilter, depositedAddresses, eligibleUnderlyingAddresses, canDepositEveryUnderlying]
  );

  const kindMarkAddresses = useMemo(
    () =>
      selectVaultKindMarkAddresses({
        listedVaults: explorerRegistryVaults,
        kindFilter,
      }),
    [explorerRegistryVaults, kindFilter]
  );

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Ignore private-mode storage.
    }
  }, []);

  const setKindFilter = useCallback(
    (kind: VaultSurface) => {
      if (canSwitchKinds) setOverrideKind(kind);
    },
    [canSwitchKinds]
  );

  const value = useMemo(
    () => ({
      kindFilter,
      setKindFilter,
      canSwitchKinds,
      explorerRegistryVaults,
      kindMarkAddresses,
      isResolving,
    }),
    [
      kindFilter,
      setKindFilter,
      canSwitchKinds,
      explorerRegistryVaults,
      kindMarkAddresses,
      isResolving,
    ]
  );

  return (
    <VaultKindContext.Provider value={value}>{children}</VaultKindContext.Provider>
  );
}

export function useVaultKind() {
  const context = useContext(VaultKindContext);
  if (!context) {
    throw new Error('useVaultKind must be used within a VaultKindProvider');
  }
  return context;
}
