'use client';

import { createContext, useContext, useState, useMemo, ReactNode } from 'react';

/** Nav settings: V2-only UI, or Dev (labeled "Dev"; stored as `all`) for v1+v2 explorer and test bypasses. */
export type VaultVersionPreference = 'v2' | 'all';

/** Explorer table filter when preference is `all`. */
export type VaultExplorerVersionFilter = 'v1' | 'v2' | 'all';

/** Effective list filter version (used across vault lists, transact, dropdown). */
export type VaultVersion = VaultExplorerVersionFilter;

interface VaultVersionContextType {
  preference: VaultVersionPreference;
  setPreference: (preference: VaultVersionPreference) => void;
  explorerVersion: VaultExplorerVersionFilter;
  setExplorerVersion: (filter: VaultExplorerVersionFilter) => void;
  /** Resolved filter: `v2` when preference is v2, else explorerVersion. */
  version: VaultVersion;
  showExplorerVersionFilter: boolean;
  showVersionBadges: boolean;
}

const VaultVersionContext = createContext<VaultVersionContextType | undefined>(undefined);

const PREFERENCE_STORAGE_KEY = 'muscadine-vault-version-default-v2';
const EXPLORER_FILTER_STORAGE_KEY = 'muscadine-vault-explorer-version-filter-v2-default';

export const DEFAULT_VAULT_FILTER_VERSION: VaultVersion = 'v2';

function readPreference(): VaultVersionPreference {
  if (typeof window === 'undefined') return 'v2';
  const stored = localStorage.getItem(PREFERENCE_STORAGE_KEY);
  if (stored === 'all') return 'all';
  // Legacy `v1` / `v2` keys → V2-only settings mode
  return 'v2';
}

function readExplorerFilter(): VaultExplorerVersionFilter {
  if (typeof window === 'undefined') return 'v2';
  const stored = localStorage.getItem(EXPLORER_FILTER_STORAGE_KEY);
  if (stored === 'v1' || stored === 'v2' || stored === 'all') return stored;
  return 'v2';
}

export function VaultVersionProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<VaultVersionPreference>(readPreference);
  const [explorerVersion, setExplorerVersionState] =
    useState<VaultExplorerVersionFilter>(readExplorerFilter);

  const setPreference = (newPreference: VaultVersionPreference) => {
    setPreferenceState(newPreference);
    if (typeof window !== 'undefined') {
      localStorage.setItem(PREFERENCE_STORAGE_KEY, newPreference);
    }
  };

  const setExplorerVersion = (filter: VaultExplorerVersionFilter) => {
    setExplorerVersionState(filter);
    if (typeof window !== 'undefined') {
      localStorage.setItem(EXPLORER_FILTER_STORAGE_KEY, filter);
    }
  };

  const version = useMemo<VaultVersion>(
    () => (preference === 'v2' ? 'v2' : explorerVersion),
    [preference, explorerVersion]
  );

  const showExplorerVersionFilter = preference === 'all';
  const showVersionBadges = preference === 'all';

  const value: VaultVersionContextType = {
    preference,
    setPreference,
    explorerVersion,
    setExplorerVersion,
    version,
    showExplorerVersionFilter,
    showVersionBadges,
  };

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
