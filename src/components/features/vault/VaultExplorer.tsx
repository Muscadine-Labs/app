'use client';

import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { BASE_CHAIN_ID } from '@/lib/constants';
import {
  getDefaultVaultKindFilter,
  hasVisibleUnderlyingVaults,
} from '@/lib/vault-access';
import {
  buildExplorerVaultCandidates,
  getDepositedVaultAddressSet,
  selectRegistryVaultsForExplorer,
  sortVaultsForDisplay,
  type VaultKindFilter,
} from '@/lib/vault-utils';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useIsClient } from '@/hooks/useClientOnly';
import { useUnderlyingDepositAccess } from '@/hooks/useUnderlyingDepositAccess';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { Skeleton } from '@/components/ui/Skeleton';
import VaultExplorerFilters, {
  VaultExplorerFilterState,
  getDefaultExplorerFilters,
} from '@/components/features/vault/VaultExplorerFilters';
import VaultExplorerTable from '@/components/features/vault/VaultExplorerTable';

const KIND_FILTER_STORAGE_KEY = 'vault-explorer-kind-filter';

function readCachedKindFilter(address: string): VaultKindFilter | null {
  try {
    const raw = localStorage.getItem(KIND_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[address.toLowerCase()];
    if (value === 'all' || value === 'underlying' || value === 'wrappers') return value;
  } catch {
    return null;
  }
  return null;
}

function writeCachedKindFilter(address: string, kindFilter: VaultKindFilter) {
  try {
    const raw = localStorage.getItem(KIND_FILTER_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed[address.toLowerCase()] = kindFilter;
    localStorage.setItem(KIND_FILTER_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore private-mode or full storage.
  }
}

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
  const [manualKindAddress, setManualKindAddress] = useState<string | null>(null);
  const { address, isConnected } = useAccount();
  const { morphoHoldings } = useWallet();
  const { getVaultData } = useVaultData();
  const { eligibleUnderlyingAddresses } = useUnderlyingDepositAccess();
  const isMounted = useIsClient();

  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const preferUnderlyingTab = useMemo(
    () => eligibleUnderlyingAddresses.size > 0,
    [eligibleUnderlyingAddresses]
  );

  const defaultKindFilter = useMemo(
    () =>
      getDefaultVaultKindFilter({
        eligibleUnderlyingAddresses,
        depositedAddresses,
        preferUnderlying: preferUnderlyingTab,
      }),
    [eligibleUnderlyingAddresses, depositedAddresses, preferUnderlyingTab]
  );

  const cachedKindFilter = isMounted && address ? readCachedKindFilter(address) : null;
  const kindFilterManual = Boolean(address && manualKindAddress === address);

  const activeFilters = useMemo(
    () => ({
      ...filters,
      kindFilter: kindFilterManual
        ? filters.kindFilter
        : (cachedKindFilter ?? defaultKindFilter),
    }),
    [filters, kindFilterManual, cachedKindFilter, defaultKindFilter]
  );

  const handleFiltersChange = (next: VaultExplorerFilterState) => {
    if (next.kindFilter !== activeFilters.kindFilter) {
      setManualKindAddress(address ?? null);
      if (address) writeCachedKindFilter(address, next.kindFilter);
    }
    setFilters(next);
  };

  const showKindFilter = useMemo(
    () =>
      preferUnderlyingTab ||
      hasVisibleUnderlyingVaults({
        eligibleUnderlyingAddresses,
        depositedAddresses,
      }),
    [preferUnderlyingTab, eligibleUnderlyingAddresses, depositedAddresses]
  );

  const filteredVaults = useMemo(() => {
    const registryVaults = selectRegistryVaultsForExplorer({
      kindFilter: showKindFilter ? activeFilters.kindFilter : 'wrappers',
      depositedAddresses,
      eligibleUnderlyingAddresses,
    });

    if (activeFilters.walletFilter === 'inWallet' && !isConnected) {
      return [];
    }

    const candidates = buildExplorerVaultCandidates(
      registryVaults,
      morphoHoldings.positions,
      activeFilters.walletFilter
    );

    const filtered = candidates.filter((vault) => {
      if (activeFilters.network === 'base' && vault.chainId !== BASE_CHAIN_ID) return false;
      if (activeFilters.asset !== 'all' && vault.symbol !== activeFilters.asset) return false;
      if (
        activeFilters.strategy !== 'all' &&
        vault.isCurated !== false &&
        vault.strategy !== activeFilters.strategy
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
    activeFilters,
    isConnected,
    isMounted,
    getVaultData,
    morphoHoldings.positions,
    depositedAddresses,
    eligibleUnderlyingAddresses,
    showKindFilter,
  ]);

  useVaultListPreloader(filteredVaults);

  const emptyMessage = useMemo(() => {
    if (activeFilters.walletFilter === 'inWallet' && !isConnected) {
      return 'Connect your wallet to see vaults you are deposited in.';
    }
    if (activeFilters.walletFilter === 'inWallet') {
      return 'No deposited vaults match the selected filters.';
    }
    if (activeFilters.walletFilter === 'inWalletAndWhitelisted') {
      return 'No vaults match the selected filters.';
    }
    return 'No vaults match the selected filters.';
  }, [activeFilters.walletFilter, isConnected]);

  const walletFilterLoading =
    activeFilters.walletFilter === 'inWallet' && isConnected && morphoHoldings.isLoading;

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      {showFilters && (
        <VaultExplorerFilters
          filters={activeFilters}
          onFiltersChange={handleFiltersChange}
          showKindFilter={showKindFilter}
        />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {walletFilterLoading ? (
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

export { getDefaultExplorerFilters as DEFAULT_FILTERS };
