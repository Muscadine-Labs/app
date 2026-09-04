'use client';

import { useMemo } from 'react';
import VaultExplorer from '@/components/features/vault/VaultExplorer';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { getAllRegistryVaults } from '@/lib/vault-utils';

export default function VaultsPage() {
  const vaults = useMemo(() => getAllRegistryVaults(), []);

  useVaultListPreloader(vaults);

  return (
    <div className="w-full bg-[var(--background)] h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 h-full min-h-full">
          <div className="flex flex-col rounded-lg bg-[var(--surface)] h-full w-full overflow-hidden">
            <VaultExplorer />
          </div>
        </div>
      </div>
    </div>
  );
}
