import Link from 'next/link';
import { VAULTS } from "@/lib/vaults";
import VaultListCard from "./VaultListCard";
import { Vault } from "../../../types/vault";
import { useWallet } from "../../../contexts/WalletContext";
import { useMemo } from "react";
import { useIsClient } from "@/hooks/useClientOnly";
import { sortVaultsForDisplay } from "@/lib/vault-utils";
import { useVaultData } from "../../../contexts/VaultDataContext";

export type VaultListFilter = 'all' | 'deposited';

interface VaultListProps {
    onVaultSelect?: (vault: Vault | null) => void;
    selectedVaultAddress?: string;
    filter?: VaultListFilter;
    title?: string;
    emptyMessage?: string;
    showBrowseLink?: boolean;
}

export default function VaultList({
    onVaultSelect,
    selectedVaultAddress,
    filter = 'all',
    title,
    emptyMessage,
    showBrowseLink = false,
}: VaultListProps = {} as VaultListProps) {
    const { morphoHoldings } = useWallet();
    const { getVaultData } = useVaultData();
    const isMounted = useIsClient();

    const headerTitle = title ?? (filter === 'deposited' ? 'Your Vaults' : 'Available Vaults');

    const baseVaults = useMemo(() => {
        const all = Object.values(VAULTS).map((vault) => ({
            address: vault.address,
            name: vault.name,
            symbol: vault.symbol,
            vaultSymbol: vault.vaultSymbol,
            chainId: vault.chainId,
            version: vault.version,
            strategy: vault.strategy,
            isCurated: true,
        }));

        if (filter === 'deposited') {
            const depositedAddresses = new Set(
                morphoHoldings.positions.map((p) => p.vault.address.toLowerCase())
            );
            return all.filter((vault) => depositedAddresses.has(vault.address.toLowerCase()));
        }

        return all;
    }, [filter, morphoHoldings.positions]);
    
    const sortedVaults = useMemo(() => {
        if (!isMounted) {
            return baseVaults;
        }

        return sortVaultsForDisplay(
            baseVaults,
            morphoHoldings.positions,
            (address) => getVaultData(address)?.totalDeposits ?? 0
        );
    }, [baseVaults, isMounted, morphoHoldings.positions, getVaultData]);

    const displayedVaults = useMemo(() => {
        if (filter !== 'deposited') {
            return sortedVaults;
        }

        if (!isMounted) {
            return [];
        }

        const depositedAddresses = new Set(
            morphoHoldings.positions.map((position) => position.vault.address.toLowerCase())
        );

        return sortedVaults.filter((vault) => depositedAddresses.has(vault.address.toLowerCase()));
    }, [filter, sortedVaults, isMounted, morphoHoldings.positions]);

    const handleVaultClick = onVaultSelect ? (vault: Vault) => {
        if (vault.address === selectedVaultAddress) {
            onVaultSelect(null);
        } else {
            onVaultSelect(vault);
        }
    } : undefined;

    const defaultEmptyMessage =
        filter === 'deposited'
            ? 'No vault deposits yet.'
            : 'No vaults match the selected filters.';

    return (
        <div className="flex rounded-lg w-full justify-center items-center h-full">
            <div className="flex flex-col items-center justify-center h-full w-full">
                <div className="flex flex-col items-start justify-start w-full h-full p-2 sm:p-4">
                    <div className="hidden md:block w-full px-4 md:px-6 pb-2 border-b border-[var(--border)] mb-0">
                        <div className="flex items-center justify-between w-full">
                            <h1 className="text-md text-left text-[var(--foreground)]">{headerTitle}</h1>
                            <div className="flex items-center gap-6 flex-1 justify-end">
                                <div className="text-sm text-[var(--foreground-secondary)] text-right min-w-[140px]">
                                    Your Position
                                </div>
                                <div className="text-sm text-[var(--foreground-secondary)] text-right min-w-[120px]">
                                    APY / TVL
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="md:hidden w-full px-2 pb-2 border-b border-[var(--border)] mb-0">
                        <h1 className="text-md text-left text-[var(--foreground)]">{headerTitle}</h1>
                    </div>
                    <div className="flex flex-col items-start justify-start w-full h-full overflow-y-auto pt-0 [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-[var(--border)]">
                        {displayedVaults.length === 0 ? (
                            <div className="w-full px-4 py-8 text-center">
                                <p className="text-sm text-[var(--foreground-muted)]">
                                    {emptyMessage ?? defaultEmptyMessage}
                                </p>
                                {showBrowseLink && filter === 'deposited' && (
                                    <Link
                                        href="/vaults"
                                        className="inline-block mt-3 text-sm text-[var(--primary)] hover:underline"
                                    >
                                        Browse available vaults
                                    </Link>
                                )}
                            </div>
                        ) : (
                            displayedVaults.map((vault) => (
                                <div key={vault.address} className="w-full">
                                    <VaultListCard 
                                        vault={vault} 
                                        onClick={handleVaultClick}
                                        isSelected={selectedVaultAddress ? vault.address === selectedVaultAddress : undefined}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
