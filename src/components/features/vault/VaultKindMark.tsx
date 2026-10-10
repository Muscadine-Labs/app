'use client';

import type { VaultKind } from '@/lib/vaults';
import { useVaultKind } from '@/contexts/VaultKindContext';

const KIND_MARK_CLASS =
  'shrink-0 inline-flex rounded-md bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--foreground-muted)] whitespace-nowrap';

/** Kind pill. A mixed list labels every vault; a single-kind list labels none. */
export function VaultKindMark({
  kind,
  address,
  show,
}: {
  kind?: VaultKind;
  address?: string;
  /** Pass to override. Omit it to follow the list's mixed-kind labels. */
  show?: boolean;
}) {
  const { kindMarkAddresses } = useVaultKind();

  if (kind !== 'wrapper' && kind !== 'underlying') return null;
  const showKind =
    show ?? (address ? kindMarkAddresses.has(address.toLowerCase()) : false);
  if (!showKind) return null;

  return (
    <span className={KIND_MARK_CLASS}>
      {kind === 'wrapper' ? 'wrapper vault' : 'underlying'}
    </span>
  );
}
