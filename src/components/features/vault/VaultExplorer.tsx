'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { explorerChainId } from '@/lib/constants';
import {
  assetOptionsForNetwork,
  getDefaultExplorerFilters,
  isListedAssetSymbol,
  loadExplorerFilters,
  persistExplorerFilters,
  reconcileExplorerFilters,
  strategyFromVaultName,
  strategyOptionsForNetwork,
  type VaultExplorerFilterState,
} from '@/lib/explorer-filters';
import { buildExplorerVaultCandidates, sortVaultsForDisplay } from '@/lib/vault-utils';
import { useExplorerVaults } from '@/contexts/ExplorerVaultsContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useIsClient } from '@/hooks/useClientOnly';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { Skeleton } from '@/components/ui/Skeleton';
import VaultExplorerFilters from '@/components/features/vault/VaultExplorerFilters';
import VaultExplorerTable from '@/components/features/vault/VaultExplorerTable';

interface VaultExplorerProps {
  initialFilters?: Partial<VaultExplorerFilterState>;
  showFilters?: boolean;
}

function VaultExplorerContent({
  initialFilters,
  showFilters = true,
}: VaultExplorerProps) {
  const [filters, setFilters] = useState<VaultExplorerFilterState>(() =>
    reconcileExplorerFilters({
      ...getDefaultExplorerFilters(),
      ...initialFilters,
    })
  );
  const [filtersReady, setFiltersReady] = useState(false);
  const initialFiltersRef = useRef(initialFilters);
  const { isConnected } = useAccount();
  const { explorerRegistryVaults, isResolving } = useExplorerVaults();
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const isMounted = useIsClient();
  useEffect(() => {
    const stored = reconcileExplorerFilters({
      ...loadExplorerFilters(),
      ...initialFiltersRef.current,
    });
    setFilters(stored);
    persistExplorerFilters(stored);
    setFiltersReady(true);
  }, []);

  const filteredVaults = useMemo(() => {
    if (filters.walletFilter === 'inWallet' && !isConnected) {
      return [];
    }

    const candidates = buildExplorerVaultCandidates(
      explorerRegistryVaults,
      morphoHoldings.positions,
      filters.walletFilter
    );

    const filtered = candidates.filter((vault) => {
      if (vault.version !== 'v2') return false;
      if (!isListedAssetSymbol(vault.symbol)) return false;
      if (filters.network !== 'all' && vault.chainId !== explorerChainId(filters.network)) {
        return false;
      }
      if (
        filters.asset !== 'all' &&
        vault.symbol.toUpperCase() !== filters.asset.toUpperCase()
      ) {
        return false;
      }
      if (filters.strategy !== 'all') {
        const strategy = vault.strategy ?? strategyFromVaultName(vault.name);
        if (strategy !== filters.strategy) return false;
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
    explorerRegistryVaults,
    isConnected,
    isMounted,
    getVaultData,
    morphoHoldings.positions,
  ]);

  useVaultListPreloader(filtersReady ? filteredVaults : []);

  const emptyMessage = useMemo(() => {
    if (filters.walletFilter === 'inWallet' && !isConnected) {
      return 'Connect your wallet to see vaults you are deposited in.';
    }
    if (filters.walletFilter === 'inWallet') {
      return 'No deposited vaults match the selected filters.';
    }
    return 'No vaults match the selected filters.';
  }, [filters.walletFilter, isConnected]);

  const listLoading =
    !filtersReady ||
    isResolving ||
    (filters.walletFilter === 'inWallet' && isConnected && morphoHoldings.isLoading);

  const applyFilters = (next: VaultExplorerFilterState) => {
    const reconciled = reconcileExplorerFilters(next);
    setFilters(reconciled);
    persistExplorerFilters(reconciled);
  };

  if (!filtersReady) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <Skeleton width="100%" height="12rem" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      {showFilters && (
        <VaultExplorerFilters
          filters={filters}
          strategyOptions={strategyOptionsForNetwork(filters.network)}
          assetOptions={assetOptionsForNetwork(filters.network)}
          onFiltersChange={applyFilters}
        />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {listLoading ? (
          <div className="px-4 sm:px-6 py-8">
            <Skeleton width="100%" height="12rem" />
          </div>
        ) : (
          <VaultExplorerTable
            vaults={filteredVaults}
            emptyMessage={emptyMessage}
          />
        )}
      </div>
    </div>
  );
}

export default function VaultExplorer(props: VaultExplorerProps) {
  return <VaultExplorerContent {...props} />;
}
