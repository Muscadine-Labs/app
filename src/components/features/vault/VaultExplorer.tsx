'use client';

import { useMemo, useState } from 'react';
import { VAULTS } from '@/lib/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { Vault } from '@/types/vault';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useVaultVersion, DEFAULT_VAULT_FILTER_VERSION } from '@/contexts/VaultVersionContext';
import { useIsClient } from '@/hooks/useClientOnly';
import VaultExplorerFilters, {
  VaultExplorerFilterState,
} from './VaultExplorerFilters';
import VaultExplorerTable from './VaultExplorerTable';

const DEFAULT_FILTERS: VaultExplorerFilterState = {
  network: 'all',
  asset: 'all',
  inWalletOnly: false,
};

interface VaultExplorerProps {
  initialFilters?: Partial<VaultExplorerFilterState>;
  showFilters?: boolean;
}

export default function VaultExplorer({
  initialFilters,
  showFilters = true,
}: VaultExplorerProps) {
  const [filters, setFilters] = useState<VaultExplorerFilterState>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const { version } = useVaultVersion();
  const isMounted = useIsClient();
  const effectiveVersion = isMounted ? version : DEFAULT_VAULT_FILTER_VERSION;

  const depositedAddresses = useMemo(
    () =>
      new Set(
        morphoHoldings.positions.map((position) => position.vault.address.toLowerCase())
      ),
    [morphoHoldings.positions]
  );

  const filteredVaults = useMemo(() => {
    const baseVaults: Vault[] = Object.values(VAULTS)
      .filter((vault) => effectiveVersion === 'all' || vault.version === effectiveVersion)
      .map((vault) => ({
        address: vault.address,
        name: vault.name,
        symbol: vault.symbol,
        chainId: vault.chainId,
        version: vault.version,
      }));

    const filtered = baseVaults.filter((vault) => {
      if (filters.network === 'base' && vault.chainId !== BASE_CHAIN_ID) return false;
      if (filters.asset !== 'all' && vault.symbol !== filters.asset) return false;
      if (filters.inWalletOnly && !depositedAddresses.has(vault.address.toLowerCase())) {
        return false;
      }
      return true;
    });

    if (!isMounted) {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      const tvlA = getVaultData(a.address)?.totalDeposits ?? 0;
      const tvlB = getVaultData(b.address)?.totalDeposits ?? 0;
      if (tvlA !== tvlB) return tvlB - tvlA;

      return a.name.localeCompare(b.name);
    });
  }, [filters, depositedAddresses, isMounted, getVaultData, effectiveVersion]);

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      {showFilters && (
        <VaultExplorerFilters filters={filters} onFiltersChange={setFilters} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <VaultExplorerTable vaults={filteredVaults} />
      </div>
    </div>
  );
}

export { DEFAULT_FILTERS };
