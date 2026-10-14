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

/**
 * Settings row: label, info popover, and a dropdown of options. The native option list can sit
 * outside the hover menu, so `onInfoOpenChange` also reports the dropdown as open while focused,
 * keeping a hover-to-close menu open while the user picks.
 */
export function SettingSelectRow<T extends string>({
  label,
  info,
  value,
  options,
  onChange,
  onInfoOpenChange,
}: {
  label: string;
  info: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
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
        <select
          aria-label={label}
          value={value}
          onClick={(event) => event.stopPropagation()}
          onFocus={() => onInfoOpenChange?.(true)}
          onBlur={() => onInfoOpenChange?.(false)}
          onChange={(event) => onChange(event.target.value as T)}
          className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-sm text-[var(--foreground)] focus:outline-none cursor-pointer"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
