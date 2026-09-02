'use client';

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { logger } from '@/lib/logger';

const STORAGE_KEY = 'muscadine-vault-wrappers';
const CHANGE_EVENT = 'muscadine-vault-wrappers';
const DEFAULT_WRAPPERS_ONLY = true;

interface VaultSettingsContextType {
  /** When true, explorer defaults to fee wrappers only (plus any underlying deposits). */
  wrappersOnly: boolean;
  setWrappersOnly: (value: boolean) => void;
}

const VaultSettingsContext = createContext<VaultSettingsContextType | undefined>(
  undefined
);

let memoryWrappersOnly: boolean | null = null;

function readStoredWrappersOnly(): boolean {
  if (memoryWrappersOnly !== null) return memoryWrappersOnly;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
  } catch {
    // Ignore unreadable storage (private mode, etc.)
  }
  return DEFAULT_WRAPPERS_ONLY;
}

function subscribeWrappersOnly(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function VaultSettingsProvider({ children }: { children: ReactNode }) {
  const wrappersOnly = useSyncExternalStore(
    subscribeWrappersOnly,
    readStoredWrappersOnly,
    () => DEFAULT_WRAPPERS_ONLY
  );

  const setWrappersOnly = useCallback((value: boolean) => {
    memoryWrappersOnly = value;
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch (error) {
      logger.error('Failed to save vault wrappers setting', error);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return (
    <VaultSettingsContext.Provider value={{ wrappersOnly, setWrappersOnly }}>
      {children}
    </VaultSettingsContext.Provider>
  );
}

export function useVaultSettings() {
  const context = useContext(VaultSettingsContext);
  if (context === undefined) {
    throw new Error('useVaultSettings must be used within a VaultSettingsProvider');
  }
  return context;
}
