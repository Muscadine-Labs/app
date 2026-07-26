'use client';

import type { ReactNode } from 'react';

interface VaultTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** Optional actions rendered on the right of the tab row (desktop). */
  actions?: ReactNode;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'position', label: 'My Position' },
  { id: 'history', label: 'History' },
];

export default function VaultTabs({ activeTab, onTabChange, actions }: VaultTabsProps) {
  return (
    <div className="mb-5 border-b border-[var(--border-subtle)] px-4 sm:px-6 md:px-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex flex-1 min-w-0 gap-1 sm:gap-2 overflow-x-auto overscroll-x-contain flex-nowrap scrollbar-hide [-webkit-overflow-scrolling:touch]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`shrink-0 px-3 sm:px-5 py-3 text-sm sm:text-base font-medium transition-colors relative cursor-pointer touch-manipulation ${
                activeTab === tab.id
                  ? 'text-[var(--foreground)]'
                  : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] -mb-px" />
              )}
            </button>
          ))}
        </div>
        {actions ? (
          <div className="hidden md:flex items-center gap-2 shrink-0 pb-0.5">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
