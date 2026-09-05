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
import type { VaultKindFilter } from '@/lib/vault-utils';

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

export type VaultAssetFilter = 'all' | 'USDC' | 'cbBTC' | 'WETH';
export type VaultNetworkFilter = 'all' | 'base';
export type VaultStrategyFilter = 'all' | VaultStrategy;
export type VaultWalletFilter = 'all' | 'inWallet' | 'inWalletAndWhitelisted';
export type { VaultKindFilter };

const WALLET_FILTER_OPTIONS: Array<{
  value: VaultWalletFilter;
  label: string;
  description: string;
}> = [
  {
    value: 'inWalletAndWhitelisted',
    label: 'Deposits + whitelisted',
    description: 'Yours plus whitelisted vaults',
  },
  {
    value: 'inWallet',
    label: 'In wallet',
    description: 'Your deposits only',
  },
  { value: 'all', label: 'Whitelisted', description: 'Whitelisted registry' },
];

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth="1.75"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 11h.01" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18" />
    </svg>
  );
}

function WalletFilterControl({
  value,
  onChange,
}: {
  value: VaultWalletFilter;
  onChange: (value: VaultWalletFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = value !== 'all';
  const selected =
    WALLET_FILTER_OPTIONS.find((option) => option.value === value) ??
    WALLET_FILTER_OPTIONS[0];

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps()}
        aria-label={`Wallet filter: ${selected.label}`}
        title={selected.label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-pointer touch-manipulation shrink-0 ${
          isActive
            ? 'text-[var(--primary)] bg-[var(--primary-subtle)]'
            : 'text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)]'
        }`}
      >
        <WalletIcon className="h-4 w-4" />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] w-48 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] py-1 shadow-lg"
          >
            {WALLET_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left transition-colors cursor-pointer ${
                  option.value === value
                    ? 'bg-[var(--primary-subtle)]'
                    : 'hover:bg-[var(--surface-hover)]'
                }`}
              >
                <span
                  className={`block text-xs font-medium ${
                    option.value === value
                      ? 'text-[var(--primary)]'
                      : 'text-[var(--foreground)]'
                  }`}
                >
                  {option.label}
                </span>
                <span className="block text-[10px] text-[var(--foreground-muted)] mt-0.5">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export interface VaultExplorerFilterState {
  network: VaultNetworkFilter;
  asset: VaultAssetFilter;
  strategy: VaultStrategyFilter;
  walletFilter: VaultWalletFilter;
  kindFilter: VaultKindFilter;
}

interface VaultExplorerFiltersProps {
  filters: VaultExplorerFilterState;
  onFiltersChange: (filters: VaultExplorerFilterState) => void;
  showKindFilter: boolean;
}

export function getDefaultExplorerFilters(): VaultExplorerFilterState {
  return {
    network: 'all',
    asset: 'all',
    strategy: 'all',
    walletFilter: 'inWalletAndWhitelisted',
    kindFilter: 'wrappers',
  };
}

export default function VaultExplorerFilters({
  filters,
  onFiltersChange,
  showKindFilter,
}: VaultExplorerFiltersProps) {
  const update = (partial: Partial<VaultExplorerFilterState>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  const assetOptions = [
    { label: 'All', value: 'all' },
    { label: 'USDC', value: 'USDC' },
    { label: 'cbBTC', value: 'cbBTC' },
    { label: 'WETH', value: 'WETH' },
  ];

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
            options={assetOptions}
            onChange={(value) => update({ asset: value as VaultAssetFilter })}
          />
          {showKindFilter && (
            <FilterDropdown
              label="Vaults"
              value={filters.kindFilter}
              options={[
                { label: 'All', value: 'all' },
                { label: 'Underlying', value: 'underlying' },
                { label: 'Wrappers', value: 'wrappers' },
              ]}
              onChange={(value) => update({ kindFilter: value as VaultKindFilter })}
            />
          )}
        </div>

        <WalletFilterControl
          value={filters.walletFilter}
          onChange={(walletFilter) => update({ walletFilter })}
        />
      </div>
    </div>
  );
}
