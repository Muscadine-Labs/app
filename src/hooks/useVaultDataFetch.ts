import { useEffect, useCallback, useRef } from 'react';
import { useVaultData } from '../contexts/VaultDataContext';
import { Vault } from '../types/vault';

interface UseVaultDataFetchOptions {
  autoFetch?: boolean;
  chainId?: number;
}

function vaultPreloadKey(vault: Vault): string {
  return `${vault.address.toLowerCase()}:${vault.chainId}`;
}

export function useVaultDataFetch(vault: Vault | null, options: UseVaultDataFetchOptions = {}) {
  const { autoFetch = true, chainId = 8453 } = options;
  const { 
    fetchVaultData,
    getVaultData,
    getVaultError,
    isLoading, 
    hasError 
  } = useVaultData();

  const vaultAddress = vault?.address ?? null;
  const vaultChainId = vault?.chainId ?? chainId;
  const fetchedRef = useRef<string | null>(null);

  const fetchAllData = useCallback(async (address: string, effectiveChainId: number = chainId) => {
    if (!address) return;

    try {
      await fetchVaultData(address, effectiveChainId);
    } catch {
      // Error is handled by context error state
    }
  }, [fetchVaultData, chainId]);

  useEffect(() => {
    if (!autoFetch || !vaultAddress) return;

    const fetchKey = `${vaultAddress.toLowerCase()}:${vaultChainId}`;
    if (fetchedRef.current === fetchKey) return;
    fetchedRef.current = fetchKey;

    void fetchAllData(vaultAddress, vaultChainId);
  }, [autoFetch, vaultAddress, vaultChainId, fetchAllData]);

  return {
    vaultData: vault ? getVaultData(vault.address) : null,
    isLoading: vault ? isLoading(vault.address) : false,
    hasError: vault ? hasError(vault.address) : false,
    errorMessage: vault ? getVaultError(vault.address) : null,
    refetch: vault ? () => fetchAllData(vault.address, vault.chainId) : () => {},
  };
}

/** Preload vault complete data once per address per session — avoids retry storms on re-render. */
export function useVaultListPreloader(vaults: Vault[]) {
  const { preloadVaults } = useVaultData();
  const preloadedRef = useRef(new Set<string>());

  const vaultKeys = vaults
    .map((vault) => vaultPreloadKey(vault))
    .sort()
    .join('|');

  useEffect(() => {
    const pending = vaults.filter((vault) => !preloadedRef.current.has(vaultPreloadKey(vault)));
    if (pending.length === 0) return;

    pending.forEach((vault) => preloadedRef.current.add(vaultPreloadKey(vault)));
    void preloadVaults(pending);
    // vaultKeys tracks address:chainId set; vaults is read from the render that produced vaultKeys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKeys, preloadVaults]);
}
