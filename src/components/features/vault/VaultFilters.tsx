'use client';

import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultVersionFilter = 'v1' | 'v2' | 'all';

interface VaultFiltersProps {
  version: VaultVersionFilter;
  onVersionChange: (version: VaultVersionFilter) => void;
}

export default function VaultFilters({ version, onVersionChange }: VaultFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 mb-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--foreground-secondary)]">Network</span>
        <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)]">
          Base
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--foreground-secondary)]">Version</span>
        <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {(['v1', 'v2', 'all'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onVersionChange(option)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
                version === option
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {option === 'all' ? 'All' : option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <span className="text-xs text-[var(--foreground-muted)] sm:ml-auto">
        Chain ID {BASE_CHAIN_ID}
      </span>
    </div>
  );
}
