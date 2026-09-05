'use client';

import { useMemo } from 'react';
import type { VaultKind } from '@/lib/vaults';
import { hasVisibleUnderlyingVaults } from '@/lib/vault-access';
import { getDepositedVaultAddressSet } from '@/lib/vault-utils';
import { useWallet } from '@/contexts/WalletContext';
import { useUnderlyingDepositAccess } from '@/hooks/useUnderlyingDepositAccess';

const KIND_MARK_CLASS =
  'shrink-0 inline-flex rounded-md bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--foreground-muted)] whitespace-nowrap';

/** Kind pill — explorer: when both product types are visible; dashboard passes `show`. */
export function VaultKindMark({
  kind,
  show,
}: {
  kind?: VaultKind;
  show?: boolean;
}) {
  const { morphoHoldings } = useWallet();
  const { eligibleUnderlyingAddresses } = useUnderlyingDepositAccess();
  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );

  if (show === false) return null;

  const showKind =
    show === true ||
    (kind === 'wrapper' || kind === 'underlying'
      ? hasVisibleUnderlyingVaults({
          eligibleUnderlyingAddresses,
          depositedAddresses,
        })
      : false);

  if (!showKind) return null;
  return (
    <span className={KIND_MARK_CLASS}>{kind === 'wrapper' ? 'wrapper' : 'underlying'}</span>
  );
}
