'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

type VaultVersion = 'v1' | 'v2' | 'all';

interface VaultVersionContextType {
  version: VaultVersion;
  setVersion: (version: VaultVersion) => void;
}

const VaultVersionContext = createContext<VaultVersionContextType | undefined>(undefined);

// Bumped when default changed to v2 so prior localStorage 'v1' does not override.
const VAULT_VERSION_STORAGE_KEY = 'muscadine-vault-version-default-v2';

export const DEFAULT_VAULT_FILTER_VERSION: VaultVersion = 'v2';

export function VaultVersionProvider({ children }: { children: ReactNode }) {
  // Use lazy initialization to avoid setState in effect
  const [version, setVersionState] = useState<VaultVersion>(() => {
    if (typeof window === 'undefined') return DEFAULT_VAULT_FILTER_VERSION;
    const stored = localStorage.getItem(VAULT_VERSION_STORAGE_KEY) as VaultVersion | null;
    if (stored && (stored === 'v1' || stored === 'v2' || stored === 'all')) {
      return stored;
    }
    return DEFAULT_VAULT_FILTER_VERSION;
  });

  // Persist version to localStorage
  const setVersion = (newVersion: VaultVersion) => {
    setVersionState(newVersion);
    if (typeof window !== 'undefined') {
      localStorage.setItem(VAULT_VERSION_STORAGE_KEY, newVersion);
    }
  };

  return (
    <VaultVersionContext.Provider value={{ version, setVersion }}>
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

