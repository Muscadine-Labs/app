'use client';

import { useMemo, useState } from 'react';
import { VAULTS } from '@/lib/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { Vault } from '@/types/vault';
import { sortVaultsForDisplay } from '@/lib/vault-utils';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useVaultVersion } from '@/contexts/VaultVersionContext';
import { useIsClient } from '@/hooks/useClientOnly';
import VaultExplorerFilters, {
  VaultExplorerFilterState,
  getDefaultExplorerFilters,
} from '@/components/features/vault/VaultExplorerFilters';
import VaultExplorerTable from '@/components/features/vault/VaultExplorerTable';

interface VaultExplorerProps {
  initialFilters?: Partial<VaultExplorerFilterState>;
  showFilters?: boolean;
}

function VaultExplorerContent({
  initialFilters,
  showFilters = true,
  isDevMode,
}: VaultExplorerProps & { isDevMode: boolean }) {
  const [filters, setFilters] = useState<VaultExplorerFilterState>(() => ({
    ...getDefaultExplorerFilters(isDevMode),
    ...initialFilters,
  }));
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const isMounted = useIsClient();

  const depositedAddresses = useMemo(
    () =>
      new Set(
        morphoHoldings.positions.map((position) => position.vault.address.toLowerCase())
      ),
    [morphoHoldings.positions]
  );

  const filteredVaults = useMemo(() => {
    const registryVaults: Vault[] = Object.values(VAULTS).map((vault) => ({
      address: vault.address,
      name: vault.name,
      symbol: vault.symbol,
      vaultSymbol: vault.vaultSymbol,
      chainId: vault.chainId,
      version: vault.version,
      strategy: vault.strategy,
      isCurated: true,
    }));

    const filtered = registryVaults.filter((vault) => {
      if (filters.network === 'base' && vault.chainId !== BASE_CHAIN_ID) return false;
      if (filters.asset !== 'all' && vault.symbol !== filters.asset) return false;
      if (filters.strategy !== 'all' && vault.strategy !== filters.strategy) return false;
      if (filters.inWalletOnly && !depositedAddresses.has(vault.address.toLowerCase())) {
        return false;
      }
      return true;
    });

    if (!isMounted) {
      return filtered;
    }

    return sortVaultsForDisplay(
      filtered,
      morphoHoldings.positions,
      (address) => getVaultData(address)?.totalDeposits ?? 0
    );
  }, [filters, depositedAddresses, isMounted, getVaultData, morphoHoldings.positions]);

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

export default function VaultExplorer(props: VaultExplorerProps) {
  const { isDevMode } = useVaultVersion();
  return <VaultExplorerContent key={isDevMode ? 'dev' : 'standard'} {...props} isDevMode={isDevMode} />;
}

export { getDefaultExplorerFilters as DEFAULT_FILTERS };
