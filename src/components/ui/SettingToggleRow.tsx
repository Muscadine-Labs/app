'use client';

import { useState } from 'react';

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

/** Settings row: label, info button (hover with a mouse, tap otherwise) and a switch. */
export function SettingToggleRow({
  label,
  info,
  checked,
  onChange,
}: {
  label: string;
  info: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--foreground)]">
          <span>{label}</span>
          <button
            type="button"
            aria-label={`About ${label}`}
            aria-expanded={showInfo}
            onClick={(event) => {
              event.stopPropagation();
              // A mouse already shows it on hover; taps and keyboard toggle it.
              if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') return;
              setShowInfo((open) => !open);
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') setShowInfo(true);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') setShowInfo(false);
            }}
            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold leading-none transition-colors cursor-pointer ${
              showInfo
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-[var(--foreground-muted)] text-[var(--foreground-muted)] hover:border-[var(--foreground-secondary)] hover:text-[var(--foreground-secondary)]'
            }`}
          >
            i
          </button>
        </span>
        <Switch label={label} checked={checked} onChange={onChange} />
      </div>
      {showInfo ? (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--foreground-secondary)]">{info}</p>
      ) : null}
    </div>
  );
}
