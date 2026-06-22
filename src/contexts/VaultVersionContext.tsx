'use client';

import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';

/** Standard UI, or Dev mode for extra explorer filters and test bypasses. */
export type VaultVersionPreference = 'v2' | 'all';

interface VaultVersionContextType {
  preference: VaultVersionPreference;
  setPreference: (preference: VaultVersionPreference) => void;
  /** True when Dev mode is on (`preference === 'all'`). */
  isDevMode: boolean;
}

const VaultVersionContext = createContext<VaultVersionContextType | undefined>(undefined);

const PREFERENCE_STORAGE_KEY = 'muscadine-vault-version-default-v2';

function readPreference(): VaultVersionPreference {
  if (typeof window === 'undefined') return 'v2';
  const stored = localStorage.getItem(PREFERENCE_STORAGE_KEY);
  if (stored === 'all') return 'all';
  return 'v2';
}

export function VaultVersionProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<VaultVersionPreference>(readPreference);

  const setPreference = useCallback((newPreference: VaultVersionPreference) => {
    setPreferenceState(newPreference);
    if (typeof window !== 'undefined') {
      localStorage.setItem(PREFERENCE_STORAGE_KEY, newPreference);
    }
  }, []);

  const isDevMode = preference === 'all';

  const value: VaultVersionContextType = useMemo(
    () => ({
      preference,
      setPreference,
      isDevMode,
    }),
    [preference, setPreference, isDevMode]
  );

  return (
    <VaultVersionContext.Provider value={value}>
      {children}
    </VaultVersionContext.Provider>
  );
}

export function useVaultVersion() {
  const context = useContext(VaultVersionContext);
  if (context === undefined) {
    throw new Error('useVaultVersion must be used within a VaultVersionProvider');
  }
  return context;
}
