'use client';

import type { VaultKind } from '@/lib/vaults';
import { useVaultSettings } from '@/contexts/VaultSettingsContext';

const KIND_MARK_CLASS =
  'shrink-0 inline-flex rounded-md bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--foreground-muted)] whitespace-nowrap';

/** Kind pill — only when Vault wrappers is off (mixed wrapper + underlying lists). */
export function VaultKindMark({ kind }: { kind?: VaultKind }) {
  const { wrappersOnly } = useVaultSettings();
  if (wrappersOnly || (kind !== 'wrapper' && kind !== 'underlying')) return null;
  return (
    <span className={KIND_MARK_CLASS}>{kind === 'wrapper' ? 'wrapper' : 'underlying'}</span>
  );
}
