'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { VaultKindMode } from '@/lib/vault-utils';
import { type VaultPrefs, writeVaultPrefsCookie } from '@/lib/vault-prefs';

interface VaultPrefsContextType extends VaultPrefs {
  setKindMode: (mode: VaultKindMode) => void;
  setSharedData: (on: boolean) => void;
}

const VaultPrefsContext = createContext<VaultPrefsContextType | undefined>(undefined);

/** Settings → vault display prefs. Seeded from the cookie the server read, so hydration matches. */
export function VaultPrefsProvider({
  initialPrefs,
  children,
}: {
  initialPrefs: VaultPrefs;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState<VaultPrefs>(initialPrefs);

  const update = useCallback((patch: Partial<VaultPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeVaultPrefsCookie(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      ...prefs,
      setKindMode: (kindMode: VaultKindMode) => update({ kindMode }),
      setSharedData: (sharedData: boolean) => update({ sharedData }),
    }),
    [prefs, update]
  );

  return <VaultPrefsContext.Provider value={value}>{children}</VaultPrefsContext.Provider>;
}

export function useVaultPrefs() {
  const context = useContext(VaultPrefsContext);
  if (!context) throw new Error('useVaultPrefs must be used within a VaultPrefsProvider');
  return context;
}
