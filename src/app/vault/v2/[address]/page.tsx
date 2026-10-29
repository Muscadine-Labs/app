'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import {
  getDepositedVaultAddressSet,
  isOpenableVaultAddress,
  isValidEthereumAddress,
  resolveVaultForPage,
} from '@/lib/vault-utils';
import { isPartnerVaultAddress } from '@/lib/partner-vaults';
import { loadExplorerFilters, serializeExplorerFilters } from '@/lib/explorer-filters';
import { resolveVaultPageAccess, type OnChainShareState } from '@/lib/vault-access';
import { useExplorerVaults } from '@/contexts/ExplorerVaultsContext';
import { ERC20_BALANCE_ABI } from '@/lib/abis';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useVaultDataFetch } from '@/hooks/useVaultDataFetch';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import { useWallet } from '@/contexts/WalletContext';
import VaultHero from '@/components/features/vault/VaultHero';
import VaultTabs from '@/components/features/vault/VaultTabs';
import { VAULT_OVERVIEW_SECTIONS, VaultSectionNav } from '@/components/features/vault/VaultSectionNav';
import VaultHistory from '@/components/features/vault/VaultHistory';
import { Skeleton } from '@/components/ui/Skeleton';
import type { VaultTransactionTab } from '@/hooks/useScopedVaultTransaction';
import { useTransactionState } from '@/contexts/TransactionContext';

function VaultTabSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton width="100%" height="12rem" />
      <div className="space-y-3">
        <Skeleton width="100%" height="3.5rem" />
        <Skeleton width="100%" height="3.5rem" />
      </div>
    </div>
  );
}

const VaultOverview = dynamic(
  () => import('@/components/features/vault/VaultOverview'),
  { loading: () => <VaultTabSkeleton /> }
);

const VaultPosition = dynamic(
  () => import('@/components/features/vault/VaultPosition'),
  { loading: () => <VaultTabSkeleton /> }
);

function VaultPageSkeleton({ className }: { className: string }) {
  return (
    <div className={className}>
      <div className="flex-shrink-0 mb-5">
        <div className="flex flex-col gap-2">
          <Skeleton width="12rem" height="2.25rem" />
          <div className="flex items-center gap-2">
            <Skeleton variant="circular" width="1.25rem" height="1.25rem" />
            <Skeleton width="4rem" height="1rem" />
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 mb-6">
        <div className="flex gap-2">
          <Skeleton width="6rem" height="2.5rem" className="mb-2" />
          <Skeleton width="8rem" height="2.5rem" className="mb-2" />
          <Skeleton width="6rem" height="2.5rem" className="mb-2" />
        </div>
      </div>

      <div className="space-y-5">
        <Skeleton width="100%" height="12rem" />
        <div className="space-y-3">
          <Skeleton width="100%" height="3.5rem" />
          <Skeleton width="100%" height="3.5rem" />
        </div>
      </div>
    </div>
  );
}

export default function VaultV2Page() {
  const params = useParams();
  const router = useRouter();
  const address = (params?.address as string) || '';
  const [activeTab, setActiveTab] = useState<string>('position');
  const [transactTab, setTransactTab] = useState<VaultTransactionTab>('deposit');
  const { status: transactStatus } = useTransactionState();
  const transactBusy =
    transactStatus === 'preview' ||
    transactStatus === 'signing' ||
    transactStatus === 'approving' ||
    transactStatus === 'confirming' ||
    transactStatus === 'success' ||
    transactStatus === 'error';

  const tabsAnchorRef = useRef<HTMLDivElement>(null);

  /** After scrolling past the sticky tabs, start the new tab at its top, not mid-page. */
  const scrollToTabsIfPast = () => {
    const anchor = tabsAnchorRef.current;
    const scroller = anchor?.closest<HTMLElement>('[data-app-scroll]');
    if (!anchor || !scroller) return;
    const offset = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (offset < 0) scroller.scrollBy({ top: offset });
  };

  const handleTabChange = (tab: string) => {
    if (transactBusy && tab !== 'position') return;
    scrollToTabsIfPast();
    if (tab === 'safety') {
      setActiveTab('position');
    } else {
      setActiveTab(tab);
    }
  };

  const vault = useMemo(() => resolveVaultForPage(address), [address]);
  const { status: walletStatus, address: walletAddress } = useAccount();
  const { morphoHoldings } = useWallet();
  const {
    eligibleVaultAddresses,
    isResolving: gatesResolving,
  } = useVaultDepositGates();
  const { listedVaultAddresses } = useExplorerVaults();
  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const shareRead = useReadContract({
    address: vault ? (vault.address as `0x${string}`) : undefined,
    chainId: vault?.chainId ?? BASE_CHAIN_ID,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!vault && !!walletAddress },
  });
  const onChainShares: OnChainShareState = !vault || !walletAddress
    ? 'unknown'
    : shareRead.data !== undefined
      ? shareRead.data > BigInt(0) ? 'held' : 'empty'
      : shareRead.isError
        ? 'unknown'
        : 'loading';

  const resolvedAccess = useMemo(() => {
    if (!vault) return 'denied' as const;
    return resolveVaultPageAccess({
      vaultAddress: vault.address,
      eligibleVaultAddresses,
      listedVaultAddresses,
      depositedAddresses,
      walletStatus,
      walletAddress,
      positionsResolvedFor: morphoHoldings.resolvedAddress,
      gatesResolving,
      onChainShares,
    });
  }, [
    vault,
    eligibleVaultAddresses,
    listedVaultAddresses,
    depositedAddresses,
    walletStatus,
    walletAddress,
    morphoHoldings.resolvedAddress,
    gatesResolving,
    onChainShares,
  ]);

  // Once allowed for this wallet, stay: a full withdraw empties the position and would
  // otherwise redirect away mid-success screen.
  const accessKey = `${vault?.address ?? ''}:${walletAddress ?? ''}`;
  const [allowedKey, setAllowedKey] = useState<string | null>(null);
  if (resolvedAccess === 'allowed' && allowedKey !== accessKey) {
    setAllowedKey(accessKey);
  }
  const pageAccess =
    resolvedAccess === 'denied' && vault && allowedKey === accessKey ? 'allowed' : resolvedAccess;

  const { vaultData, isLoading, hasError, refetch, errorMessage } = useVaultDataFetch(
    pageAccess !== 'denied' ? vault : null
  );

  const canDeposit =
    !!vault &&
    (eligibleVaultAddresses.has(vault.address.toLowerCase()) ||
      isPartnerVaultAddress(vault.address));

  useEffect(() => {
    if (!address) return;
    if (!isValidEthereumAddress(address) || !isOpenableVaultAddress(address)) {
      router.replace('/');
    }
  }, [address, router]);

  useEffect(() => {
    if (vault && pageAccess === 'denied') {
      router.replace(`/vaults?${serializeExplorerFilters(loadExplorerFilters())}`);
    }
  }, [vault, pageAccess, router]);

  const pageShellClassName = 'w-full bg-[var(--background)] flex flex-col p-4 sm:p-6 md:p-8 pb-8 min-h-full';

  if (!vault) {
    return <VaultPageSkeleton className={pageShellClassName} />;
  }

  if (pageAccess === 'denied') {
    return null;
  }

  const showLoadingSkeleton = pageAccess === 'pending' || (isLoading && !vaultData);

  if (showLoadingSkeleton) {
    return <VaultPageSkeleton className={pageShellClassName} />;
  }

  if (hasError && !vaultData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] px-4 text-center">
        <p className="text-[var(--danger)] text-sm mb-2">
          Failed to load vault data
        </p>
        {errorMessage && (
          <p className="text-[var(--foreground-secondary)] text-xs mb-4 max-w-md">
            {errorMessage}
          </p>
        )}
        <button
          onClick={refetch}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!vaultData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] px-4">
        <p className="text-[var(--foreground-muted)] text-sm">
          No vault data available
        </p>
      </div>
    );
  }

  return (
    <div className={pageShellClassName}>
      <div className="flex-shrink-0 mb-5">
        <VaultHero vaultData={vaultData} />
      </div>

      <div className="flex flex-col w-full mx-auto">
        <div ref={tabsAnchorRef} aria-hidden />
        <div data-vault-sticky-header className="sticky top-0 z-30 flex-shrink-0 mb-5 -mx-4 sm:-mx-6 md:mx-0 bg-[var(--background)]">
          <VaultTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
          {activeTab === 'overview' && (
            <div className="border-b border-[var(--border-subtle)] px-4 sm:px-6 md:px-0">
              <VaultSectionNav sections={VAULT_OVERVIEW_SECTIONS} />
            </div>
          )}
        </div>

        <div className="px-0 sm:px-2 md:px-6">
          {activeTab === 'overview' && (
            <VaultOverview vaultData={vaultData} />
          )}
          {activeTab === 'position' && (
            <VaultPosition
              vaultData={vaultData}
              transactTab={transactTab}
              onTransactTabChange={setTransactTab}
              canDeposit={canDeposit}
            />
          )}
          {activeTab === 'history' && <VaultHistory vaultData={vaultData} />}
        </div>
      </div>

    </div>
  );
}
