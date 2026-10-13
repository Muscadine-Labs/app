'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useExplorerVaults } from '@/contexts/ExplorerVaultsContext';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import { useVaultDataFetch } from '@/hooks/useVaultDataFetch';
import { formatPercentage } from '@/lib/formatter';
import {
  findVaultByAddress,
  getDepositedVaultAddressSet,
  getVaultRoute,
} from '@/lib/vault-utils';
import { getPairedVaultAddress } from '@/lib/vaults';
import type { MorphoVaultData } from '@/types/vault';

function feeLabel(performanceFee: number | undefined): string | null {
  if (performanceFee === undefined) return null;
  return `${formatPercentage(performanceFee / 100, { decimals: performanceFee % 1 === 0 ? 0 : 2 })} fee`;
}

/**
 * Underlying | Wrapper switch in the vault header. Shown only when the choice matters to this
 * wallet: it can deposit into both, holds both, or picked Wrapper / All vaults in the explorer.
 * Each side is its own page; the switch links to the other one.
 */
export function VaultPairSwitch({
  vaultData,
  disabled = false,
}: {
  vaultData: MorphoVaultData;
  /** A transaction is in progress on this page. */
  disabled?: boolean;
}) {
  const { eligibleVaultAddresses } = useVaultDepositGates();
  const { kindMode } = useExplorerVaults();
  const { morphoHoldings } = useWallet();

  const pairAddress = getPairedVaultAddress(vaultData.address);
  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const visible = (() => {
    if (!pairAddress) return false;
    if (kindMode !== 'recommended') return true;
    const keys = [vaultData.address.toLowerCase(), pairAddress.toLowerCase()];
    return (
      keys.every((key) => eligibleVaultAddresses.has(key)) ||
      keys.every((key) => depositedAddresses.has(key))
    );
  })();

  const pairVault = useMemo(
    () => (visible && pairAddress ? findVaultByAddress(pairAddress) : null),
    [visible, pairAddress]
  );
  const { vaultData: pairData } = useVaultDataFetch(pairVault);

  if (!visible || !pairAddress || !pairVault) return null;

  const sides = [
    { address: vaultData.address, kind: vaultData.kind, fee: vaultData.performanceFee, current: true },
    { address: pairAddress, kind: pairVault.kind, fee: pairData?.performanceFee, current: false },
  ].sort((a, b) => (a.kind === 'underlying' ? 0 : 1) - (b.kind === 'underlying' ? 0 : 1));

  return (
    <div
      role="group"
      aria-label="Vault type"
      className="inline-flex shrink-0 self-start min-[640px]:self-auto items-center gap-1 rounded-lg p-1 border border-[var(--border-subtle)]"
    >
      {sides.map((side) => {
        const label = side.kind === 'wrapper' ? 'Wrapper' : 'Underlying';
        const fee = feeLabel(side.fee);
        const content = (
          <>
            <span className="font-medium">{label}</span>
            {fee ? <span className="opacity-80"> · {fee}</span> : null}
          </>
        );
        const className =
          'px-3 py-1.5 text-xs rounded-md transition-colors touch-manipulation whitespace-nowrap';
        if (side.current) {
          return (
            <span
              key={side.address}
              aria-current="page"
              className={`${className} bg-[var(--primary)] text-white`}
            >
              {content}
            </span>
          );
        }
        if (disabled) {
          return (
            <span
              key={side.address}
              aria-disabled="true"
              className={`${className} text-[var(--foreground-muted)] cursor-not-allowed`}
            >
              {content}
            </span>
          );
        }
        return (
          <Link
            key={side.address}
            href={getVaultRoute(side.address)}
            className={`${className} text-[var(--foreground-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]`}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}
