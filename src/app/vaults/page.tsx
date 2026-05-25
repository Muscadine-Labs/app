'use client';

import { useMemo } from 'react';
import VaultExplorer from '@/components/features/vault/VaultExplorer';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { VAULTS } from '@/lib/vaults';
import { Vault } from '@/types/vault';

export default function VaultsPage() {
  const vaults: Vault[] = useMemo(
    () =>
      Object.values(VAULTS).map((vault) => ({
        address: vault.address,
        name: vault.name,
        symbol: vault.symbol,
        chainId: vault.chainId,
        version: vault.version,
      })),
    []
  );

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
