'use client';

import { useRef, useState } from 'react';
import { useOnClickOutside } from '@/hooks/onClickOutside';
import { useVaultVersion, DEFAULT_VAULT_FILTER_VERSION } from '@/contexts/VaultVersionContext';
import { useIsClient } from '@/hooks/useClientOnly';

interface FilterDropdownProps {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}

function FilterDropdown({ label, value, options, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, () => setOpen(false));

  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
      >
        <svg
          className="w-3 h-3 text-[var(--foreground-secondary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path strokeLinecap="round" d="M4 7h16M4 12h10M4 17h6" />
        </svg>
        <span className="text-[var(--foreground-secondary)]">{label}</span>
        <span>{selectedLabel}</span>
        <svg
          className={`w-3 h-3 text-[var(--foreground-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] py-0.5 shadow-lg">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`w-full px-2 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                option.value === value
                  ? 'bg-[var(--primary-subtle)] text-[var(--primary)]'
                  : 'text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <div className="inline-flex items-center gap-1.5 shrink-0">
      <span className="text-xs text-[var(--foreground-secondary)] whitespace-nowrap">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 overflow-hidden rounded-full transition-colors cursor-pointer ${
          checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export type VaultAssetFilter = 'all' | 'USDC' | 'cbBTC' | 'WETH';
export type VaultNetworkFilter = 'all' | 'base';

export interface VaultExplorerFilterState {
  network: VaultNetworkFilter;
  asset: VaultAssetFilter;
  inWalletOnly: boolean;
}

interface VaultExplorerFiltersProps {
  filters: VaultExplorerFilterState;
  onFiltersChange: (filters: VaultExplorerFilterState) => void;
}

export default function VaultExplorerFilters({
  filters,
  onFiltersChange,
}: VaultExplorerFiltersProps) {
  const { version, setVersion } = useVaultVersion();
  const isMounted = useIsClient();
  const effectiveVersion = isMounted ? version : DEFAULT_VAULT_FILTER_VERSION;

  const update = (partial: Partial<VaultExplorerFilterState>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 border-b border-[var(--border)] px-4 sm:px-6 py-2.5">
      <FilterDropdown
        label="Network"
        value={filters.network}
        options={[
          { label: 'All', value: 'all' },
          { label: 'Base', value: 'base' },
        ]}
        onChange={(value) => update({ network: value as VaultNetworkFilter })}
      />
      <FilterDropdown
        label="Version"
        value={effectiveVersion}
        options={[
          { label: 'V2', value: 'v2' },
          { label: 'V1', value: 'v1' },
          { label: 'All', value: 'all' },
        ]}
        onChange={(value) => setVersion(value as 'v1' | 'v2' | 'all')}
      />
      <FilterDropdown
        label="Asset"
        value={filters.asset}
        options={[
          { label: 'All', value: 'all' },
          { label: 'USDC', value: 'USDC' },
          { label: 'cbBTC', value: 'cbBTC' },
          { label: 'WETH', value: 'WETH' },
        ]}
        onChange={(value) => update({ asset: value as VaultAssetFilter })}
      />

      <div className="hidden lg:block h-4 w-px bg-[var(--border)]" />

      <Toggle
        label="In Wallet"
        checked={filters.inWalletOnly}
        onChange={(inWalletOnly) => update({ inWalletOnly })}
      />
    </div>
  );
}
