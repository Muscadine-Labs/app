export function VaultName({
  name,
  nameClassName = 'text-sm font-medium text-[var(--foreground)]',
  lines = 1,
}: {
  name: string;
  nameClassName?: string;
  /** Dashboard uses two lines so the full vault name stays readable. */
  lines?: 1 | 2;
}) {
  return (
    <span
      className={`min-w-0 max-w-full ${lines === 2 ? 'line-clamp-2 break-words' : 'truncate'} ${nameClassName}`}
    >
      {name}
    </span>
  );
}
