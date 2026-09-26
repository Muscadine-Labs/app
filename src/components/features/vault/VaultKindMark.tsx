'use client';

import { useMemo } from 'react';
import type { VaultKind } from '@/lib/vaults';
import { findVaultByAddress, getDepositedVaultAddressSet, shouldShowVaultKindMark } from '@/lib/vault-utils';
import { useWallet } from '@/contexts/WalletContext';

const KIND_MARK_CLASS =
  'shrink-0 inline-flex rounded-md bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--foreground-muted)] whitespace-nowrap';

/** Kind pill — both sides of a pair, or an underlying vault held without its wrapper. */
export function VaultKindMark({
  kind,
  address,
  show,
}: {
  kind?: VaultKind;
  address?: string;
  /** Dashboard passes this explicitly. Omit it to derive from both pair sides. */
  show?: boolean;
}) {
  const { morphoHoldings } = useWallet();
  const depositedAddresses = useMemo(
    () => getDepositedVaultAddressSet(morphoHoldings.positions),
    [morphoHoldings.positions]
  );
  const registryVault = address ? findVaultByAddress(address) : null;
  const showFromHoldings = registryVault
    ? shouldShowVaultKindMark(registryVault, depositedAddresses)
    : false;

  if (show === false) return null;

  const showKind =
    show === true ||
    (show === undefined &&
      showFromHoldings &&
      (kind === 'wrapper' || kind === 'underlying'));

  if (!showKind) return null;
  return (
    <span className={KIND_MARK_CLASS}>{kind === 'wrapper' ? 'wrapper' : 'underlying'}</span>
  );
}
