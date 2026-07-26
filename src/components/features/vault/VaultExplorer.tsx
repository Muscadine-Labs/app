'use client';

import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { VAULTS } from '@/lib/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { Vault } from '@/types/vault';
import { buildExplorerVaultCandidates, sortVaultsForDisplay } from '@/lib/vault-utils';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useIsClient } from '@/hooks/useClientOnly';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { Skeleton } from '@/components/ui/Skeleton';
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
}: VaultExplorerProps) {
  const [filters, setFilters] = useState<VaultExplorerFilterState>(() => ({
    ...getDefaultExplorerFilters(),
    ...initialFilters,
  }));
  const { isConnected } = useAccount();
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const isMounted = useIsClient();

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

    if (filters.walletFilter === 'inWallet' && !isConnected) {
      return [];
    }

    const candidates = buildExplorerVaultCandidates(
      registryVaults,
      morphoHoldings.positions,
      filters.walletFilter
    );

    const filtered = candidates.filter((vault) => {
      if (filters.network === 'base' && vault.chainId !== BASE_CHAIN_ID) return false;
      if (filters.asset !== 'all' && vault.symbol !== filters.asset) return false;
      if (
        filters.strategy !== 'all' &&
        vault.isCurated !== false &&
        vault.strategy !== filters.strategy
      ) {
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
  }, [
    filters,
    isConnected,
    isMounted,
    getVaultData,
    morphoHoldings.positions,
  ]);

  useVaultListPreloader(filteredVaults);

  const emptyMessage = useMemo(() => {
    if (filters.walletFilter === 'inWallet' && !isConnected) {
      return 'Connect your wallet to see vaults you are deposited in.';
    }
    if (filters.walletFilter === 'inWallet') {
      return 'No deposited vaults match the selected filters.';
    }
    if (filters.walletFilter === 'inWalletAndWhitelisted') {
      return 'No vaults match the selected filters.';
    }
    return 'No vaults match the selected filters.';
  }, [filters.walletFilter, isConnected]);

  const walletFilterLoading =
    filters.walletFilter === 'inWallet' && isConnected && morphoHoldings.isLoading;

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      {showFilters && (
        <VaultExplorerFilters filters={filters} onFiltersChange={setFilters} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {walletFilterLoading ? (
          <div className="px-4 sm:px-6 py-8">
            <Skeleton width="100%" height="12rem" />
          </div>
        ) : (
          <VaultExplorerTable vaults={filteredVaults} emptyMessage={emptyMessage} />
        )}
      </div>
    </div>
  );
}

export default function VaultExplorer(props: VaultExplorerProps) {
  return <VaultExplorerContent {...props} />;
}

export { getDefaultExplorerFilters as DEFAULT_FILTERS };
