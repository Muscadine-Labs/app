'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useVaultDepositGates } from '@/hooks/useVaultDepositGates';
import { getDepositedVaultAddressSet, getVaultRoute } from '@/lib/vault-utils';
import { getPairedVaultAddress } from '@/lib/vaults';
import type { MorphoVaultData } from '@/types/vault';

/**
 * Underlying | Wrapper switch in the vault header. Each side is offered only when this wallet
 * can deposit into it or holds shares in it, so the switch shows when both sides qualify.
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
  const { morphoHoldings } = useWallet();
  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  const pairAddress = getPairedVaultAddress(vaultData.address);
  if (!pairAddress) return null;
  const pairKey = pairAddress.toLowerCase();
  if (!eligibleVaultAddresses.has(pairKey) && !depositedAddresses.has(pairKey)) return null;

  const pairKind = vaultData.kind === 'wrapper' ? 'underlying' : 'wrapper';
  const sides = [
    { address: vaultData.address, kind: vaultData.kind, current: true },
    { address: pairAddress, kind: pairKind, current: false },
  ].sort((a, b) => (a.kind === 'underlying' ? 0 : 1) - (b.kind === 'underlying' ? 0 : 1));

  return (
    <div
      role="group"
      aria-label="Vault type"
      className="inline-flex shrink-0 self-start min-[640px]:self-auto items-center gap-1 rounded-lg p-1 border border-[var(--border-subtle)]"
    >
      {sides.map((side) => {
        const label = side.kind === 'wrapper' ? 'Wrapper' : 'Underlying';
        const className =
          'px-3 py-1.5 text-xs font-medium rounded-md transition-colors touch-manipulation whitespace-nowrap';
        if (side.current) {
          return (
            <span
              key={side.address}
              aria-current="page"
              className={`${className} bg-[var(--primary)] text-white`}
            >
              {label}
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
              {label}
            </span>
          );
        }
        return (
          <Link
            key={side.address}
            href={getVaultRoute(side.address)}
            className={`${className} text-[var(--foreground-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
