'use client';

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { WalletOverview, PortfolioPositionChart } from '@/components/features/wallet';
import { DashboardVaultTable } from '@/components/features/vault/VaultExplorerTable';
import { useVaultListPreloader } from '@/hooks/useVaultDataFetch';
import { useWallet } from '@/contexts/WalletContext';
import { findVaultByAddress } from '@/lib/vault-utils';
import { Vault } from '@/types/vault';

export default function Home() {
  const { address } = useAccount();
  const { morphoHoldings } = useWallet();

  const depositedVaults: Vault[] = useMemo(() => {
    return morphoHoldings.positions
      .map((position) => findVaultByAddress(position.vault.address))
      .filter((vault): vault is Vault => vault !== null)
      .sort((a, b) => {
        const positionA = morphoHoldings.positions.find(
          (position) => position.vault.address.toLowerCase() === a.address.toLowerCase()
        );
        const positionB = morphoHoldings.positions.find(
          (position) => position.vault.address.toLowerCase() === b.address.toLowerCase()
        );

        const valueA = positionA?.assetsUsd ?? 0;
        const valueB = positionB?.assetsUsd ?? 0;
        if (valueA !== valueB) return valueB - valueA;

        return a.name.localeCompare(b.name);
      });
  }, [morphoHoldings.positions]);

  useVaultListPreloader(depositedVaults);

  return (
    <div className="w-full bg-[var(--background)] h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="grid gap-4 sm:gap-6 h-full p-4 sm:p-6 grid-rows-[auto_1fr] min-h-full">
          <div className="rounded-lg min-h-[120px] md:h-40">
            <WalletOverview />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 min-h-0">
            <div className="rounded-lg min-h-[280px] sm:min-h-[360px] lg:min-h-[360px] lg:h-full flex flex-col min-h-0">
              <PortfolioPositionChart key={address ?? 'disconnected'} />
            </div>
            <div className="rounded-lg min-h-[280px] sm:min-h-[360px] lg:min-h-[360px] lg:h-full overflow-hidden">
              <div className="flex flex-col rounded-lg bg-[var(--surface)] h-full w-full">
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--border)]">
                  <h2 className="text-sm sm:text-base text-[var(--foreground)]">Your Vaults</h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <DashboardVaultTable
                    vaults={depositedVaults}
                    showBrowseLink
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
