'use client';

import { useState } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { VaultStrategy } from '@/lib/vaults';

interface FilterDropdownProps {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}

function FilterDropdown({ label, value, options, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  const setReference = refs.setReference;
  const setFloating = refs.setFloating;

  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <>
      <button
        type="button"
        ref={setReference}
        {...getReferenceProps()}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 min-h-[36px] text-xs text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer touch-manipulation shrink-0"
      >
        <svg
          className="hidden sm:block w-3 h-3 text-[var(--foreground-secondary)] shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path strokeLinecap="round" d="M4 7h16M4 12h10M4 17h6" />
        </svg>
        <span className="hidden sm:inline text-[var(--foreground-secondary)]">{label}</span>
        <span className="whitespace-nowrap">{selectedLabel}</span>
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
        <FloatingPortal>
          <div
            ref={setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] py-0.5 shadow-lg"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitem"
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
        </FloatingPortal>
      )}
    </>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <div className="inline-flex items-center gap-2 shrink-0 min-h-[36px] pl-1 sm:pl-0">
      <span className="text-xs text-[var(--foreground-secondary)] whitespace-nowrap">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors cursor-pointer touch-manipulation ${
          checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export type VaultAssetFilter = 'all' | 'USDC' | 'cbBTC' | 'WETH';
export type VaultNetworkFilter = 'all' | 'base';
export type VaultStrategyFilter = 'all' | VaultStrategy;

export interface VaultExplorerFilterState {
  network: VaultNetworkFilter;
  asset: VaultAssetFilter;
  strategy: VaultStrategyFilter;
  inWalletOnly: boolean;
}

interface VaultExplorerFiltersProps {
  filters: VaultExplorerFilterState;
  onFiltersChange: (filters: VaultExplorerFilterState) => void;
}

export function getDefaultExplorerFilters(): VaultExplorerFilterState {
  return { network: 'all', asset: 'all', strategy: 'all', inWalletOnly: false };
}

export default function VaultExplorerFilters({
  filters,
  onFiltersChange,
}: VaultExplorerFiltersProps) {
  const update = (partial: Partial<VaultExplorerFilterState>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  return (
    <div className="relative z-20 shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 overflow-x-auto overscroll-x-contain flex-nowrap [-webkit-overflow-scrolling:touch]">
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
            label="Strategy"
            value={filters.strategy}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Prime', value: 'prime' },
              { label: 'Frontier', value: 'frontier' },
            ]}
            onChange={(value) => update({ strategy: value as VaultStrategyFilter })}
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
        </div>

        <div className="hidden sm:block h-4 w-px bg-[var(--border)] shrink-0" />

        <Toggle
          label="In Wallet"
          checked={filters.inWalletOnly}
          onChange={(inWalletOnly) => update({ inWalletOnly })}
        />
      </div>
    </div>
  );
}
