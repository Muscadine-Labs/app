'use client';

import type { VaultKind } from '@/lib/vaults';
import { VaultKindMark } from './VaultKindMark';

export { VaultKindMark } from './VaultKindMark';

export function VaultNameWithWrapper({
  name,
  kind,
  address,
  nameClassName = 'text-sm font-medium text-[var(--foreground)]',
  showKindMark,
  lines = 1,
}: {
  name: string;
  kind?: VaultKind;
  address?: string;
  nameClassName?: string;
  /** Overrides the mixed-kind label from `useVaultKind().kindMarkAddresses`. */
  showKindMark?: boolean;
  /** Dashboard uses two lines so the full vault name stays readable. */
  lines?: 1 | 2;
}) {
  return (
    <span
      className={`${lines === 2 ? 'flex w-full items-start' : 'inline-flex items-center'} gap-1.5 min-w-0 max-w-full`}
    >
      <span
        className={`min-w-0 ${lines === 2 ? 'flex-1 line-clamp-2 break-words' : 'truncate'} ${nameClassName}`}
      >
        {name}
      </span>
      <VaultKindMark kind={kind} address={address} show={showKindMark} />
    </span>
  );
}
