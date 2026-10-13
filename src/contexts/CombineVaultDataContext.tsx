'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * Settings → Combine vault data. `auto` (default) shows each wrapper / underlying pair as one
 * position: vault pages, activity, the dashboard chart and Your Vaults sum both contracts.
 * `off` shows each contract on its own. A contract the wallet never touched adds nothing, so
 * `auto` only changes what a wallet that used both contracts sees.
 */
export type CombineVaultDataMode = 'auto' | 'off';

const STORAGE_KEY = 'muscadine-combine-vault-data';
const listeners = new Set<() => void>();
/** Used when storage is blocked, so the choice still lasts until reload. */
let memoryMode: CombineVaultDataMode = 'auto';

function readStoredMode(): CombineVaultDataMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off' ? 'off' : 'auto';
  } catch {
    return memoryMode;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

interface CombineVaultDataContextType {
  mode: CombineVaultDataMode;
  setMode: (mode: CombineVaultDataMode) => void;
  /** True when pairs show as one position. */
  combineVaultData: boolean;
}

const CombineVaultDataContext = createContext<CombineVaultDataContextType | undefined>(undefined);

export function CombineVaultDataProvider({ children }: { children: ReactNode }) {
  // Server and first client render use the default, so hydration matches.
  const mode = useSyncExternalStore(subscribe, readStoredMode, () => 'auto' as const);

  const setMode = useCallback((next: CombineVaultDataMode) => {
    memoryMode = next;
    try {
      if (next === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: `memoryMode` keeps the choice until reload.
    }
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, combineVaultData: mode === 'auto' }),
    [mode, setMode]
  );

  return (
    <CombineVaultDataContext.Provider value={value}>{children}</CombineVaultDataContext.Provider>
  );
}

export function useCombineVaultData() {
  const context = useContext(CombineVaultDataContext);
  if (!context) {
    throw new Error('useCombineVaultData must be used within a CombineVaultDataProvider');
  }
  return context;
}
