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
import { useUnderlyingDepositAccess } from '@/hooks/useUnderlyingDepositAccess';
import { useWrapperAdapterDepositAccess } from '@/hooks/useWrapperAdapterDepositAccess';

/** Removed. Allowlisted wallets always reopen on underlying. */
const LEGACY_STORAGE_KEY = 'vault-explorer-kind-filter';

export type VaultSurface = 'wrappers' | 'underlying';

interface VaultKindContextType {
  kindFilter: VaultSurface;
  setKindFilter: (kind: VaultSurface) => void;
  /** Underlying can be selected only when the wallet can deposit into underlying vaults. */
  canSelectUnderlying: boolean;
  /** False when every wrapper adapter is blocked from depositing into its underlying. */
  canSwitchToWrappers: boolean;
}

const VaultKindContext = createContext<VaultKindContextType | undefined>(undefined);

export function VaultKindProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { eligibleUnderlyingAddresses } = useUnderlyingDepositAccess();
  const { wrappersAcceptDeposits } = useWrapperAdapterDepositAccess();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [overrideKind, setOverrideKind] = useState<VaultSurface | null>(null);

  const canSelectUnderlying = eligibleUnderlyingAddresses.size > 0;
  const canSwitchToWrappers = wrappersAcceptDeposits;

  const autoKind: VaultSurface = canSelectUnderlying ? 'underlying' : 'wrappers';

  const addressKey = address?.toLowerCase() ?? null;
  if (addressKey !== sessionAddress) {
    setSessionAddress(addressKey);
    setOverrideKind(null);
  }
  const manualKind = addressKey && addressKey === sessionAddress ? overrideKind : null;

  const kindFilter: VaultSurface = !canSelectUnderlying
    ? 'wrappers'
    : !canSwitchToWrappers
      ? 'underlying'
      : (manualKind ?? autoKind);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Ignore private-mode storage.
    }
  }, []);

  const setKindFilter = useCallback(
    (kind: VaultSurface) => {
      if (!addressKey) return;
      if (kind === 'wrappers' && !canSwitchToWrappers) return;
      if (kind === 'underlying' && !canSelectUnderlying) return;
      setOverrideKind(kind);
    },
    [addressKey, canSelectUnderlying, canSwitchToWrappers]
  );

  const value = useMemo(
    () => ({ kindFilter, setKindFilter, canSelectUnderlying, canSwitchToWrappers }),
    [kindFilter, setKindFilter, canSelectUnderlying, canSwitchToWrappers]
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
