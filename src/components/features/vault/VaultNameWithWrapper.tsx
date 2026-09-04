'use client';

import type { VaultKind } from '@/lib/vaults';
import { VaultKindMark } from './VaultKindMark';

export { VaultKindMark } from './VaultKindMark';

export function VaultNameWithWrapper({
  name,
  kind,
  nameClassName = 'text-sm font-medium text-[var(--foreground)]',
}: {
  name: string;
  kind?: VaultKind;
  nameClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span className={`truncate ${nameClassName}`}>{name}</span>
      <VaultKindMark kind={kind} />
    </span>
  );
}
