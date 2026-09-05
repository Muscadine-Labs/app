'use client';

import type { VaultKind } from '@/lib/vaults';
import { VaultKindMark } from './VaultKindMark';

export { VaultKindMark } from './VaultKindMark';

export function VaultNameWithWrapper({
  name,
  kind,
  nameClassName = 'text-sm font-medium text-[var(--foreground)]',
  showKindMark,
}: {
  name: string;
  kind?: VaultKind;
  nameClassName?: string;
  /** Dashboard: pass true only when both pair sides are held. Explorer: omit. */
  showKindMark?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span className={`truncate ${nameClassName}`}>{name}</span>
      <VaultKindMark kind={kind} show={showKindMark} />
    </span>
  );
}
