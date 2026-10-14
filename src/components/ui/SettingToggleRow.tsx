'use client';

import { VaultStatPopover } from '@/components/features/vault/VaultStatPopover';

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--surface-hover)] border border-[var(--border)]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** Settings row: label, the same info popover used on vault pages, and a switch. */
export function SettingToggleRow({
  label,
  info,
  checked,
  onChange,
  onInfoOpenChange,
}: {
  label: string;
  info: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onInfoOpenChange?: (open: boolean) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--foreground)]">
          <span>{label}</span>
          <VaultStatPopover ariaLabel={label} align="end" onOpenChange={onInfoOpenChange}>
            <p className="py-1 text-xs leading-relaxed text-[var(--foreground-secondary)]">{info}</p>
          </VaultStatPopover>
        </span>
        <Switch label={label} checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}
