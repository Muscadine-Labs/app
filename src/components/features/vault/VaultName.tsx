import type { VaultKind } from '@/lib/vaults';

const KIND_MARK_CLASS =
  'shrink-0 inline-flex rounded-md bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--foreground-muted)] whitespace-nowrap';

/** "Wrapper" / "Underlying" pill. Only shown where a list has both contracts of a pair. */
export function VaultKindMark({ kind }: { kind?: VaultKind }) {
  if (kind !== 'wrapper' && kind !== 'underlying') return null;
  return <span className={KIND_MARK_CLASS}>{kind === 'wrapper' ? 'Wrapper' : 'Underlying'}</span>;
}

export function VaultName({
  name,
  lines = 1,
  kind,
  showKind = false,
}: {
  name: string;
  /** Dashboard uses two lines so the full vault name stays readable. */
  lines?: 1 | 2;
  kind?: VaultKind;
  /** Label the vault Wrapper / Underlying. */
  showKind?: boolean;
}) {
  const nameEl = (
    <span
      className={`min-w-0 max-w-full ${lines === 2 ? 'line-clamp-2 break-words' : 'truncate'} text-sm font-medium text-[var(--foreground)]`}
    >
      {name}
    </span>
  );
  if (!showKind || !kind) return nameEl;
  return (
    <span
      className={`${lines === 2 ? 'flex w-full items-start' : 'inline-flex items-center'} gap-1.5 min-w-0 max-w-full`}
    >
      {nameEl}
      <VaultKindMark kind={kind} />
    </span>
  );
}
