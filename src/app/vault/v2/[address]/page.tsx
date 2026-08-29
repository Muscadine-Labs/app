'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  isCuratedVaultAddress,
  isValidEthereumAddress,
  resolveVaultForPage,
} from '@/lib/vault-utils';
import { useVaultDataFetch } from '@/hooks/useVaultDataFetch';
import VaultHero from '@/components/features/vault/VaultHero';
import VaultOverview from '@/components/features/vault/VaultOverview';
import VaultTabs from '@/components/features/vault/VaultTabs';
import VaultPosition from '@/components/features/vault/VaultPosition';
import VaultHistory from '@/components/features/vault/VaultHistory';
import { Button } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import type { VaultTransactionTab } from '@/hooks/useScopedVaultTransaction';
import { useTransactionState } from '@/contexts/TransactionContext';

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
    transactStatus === 'confirming';

  const handleTabChange = (tab: string) => {
    if (transactBusy && tab !== 'position') return;
    if (tab === 'safety') {
      setActiveTab('position');
    } else {
      setActiveTab(tab);
    }
  };

  const openTransact = (tab: VaultTransactionTab) => {
    setTransactTab(tab);
    setActiveTab('position');
  };

  const vault = useMemo(() => resolveVaultForPage(address), [address]);

  const { vaultData, isLoading, hasError, refetch, errorMessage } = useVaultDataFetch(vault);

  useEffect(() => {
    if (!address) return;
    if (!isValidEthereumAddress(address) || !isCuratedVaultAddress(address)) {
      router.replace('/');
    }
  }, [address, router]);

  const showMobileSticky = activeTab === 'overview';
  const pageShellClassName = `w-full bg-[var(--background)] flex flex-col p-4 sm:p-6 md:p-8 ${
    showMobileSticky ? 'pb-24 md:pb-8' : 'pb-8'
  } min-h-full`;

  if (!vault || (isLoading && !vaultData)) {
    return (
      <div className={pageShellClassName}>
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
        <div className="flex-shrink-0 -mx-4 sm:-mx-6 md:mx-0">
          <VaultTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
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
            />
          )}
          {activeTab === 'history' && <VaultHistory vaultData={vaultData} />}
        </div>
      </div>

      {showMobileSticky ? (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur-sm">
          <div className="flex gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button onClick={() => openTransact('deposit')} variant="primary" size="md" fullWidth>
              Deposit
            </Button>
            <Button onClick={() => openTransact('withdraw')} variant="secondary" size="md" fullWidth>
              Withdraw
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
