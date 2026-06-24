'use client';

interface VaultTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'position', label: 'My Position' },
  { id: 'history', label: 'History' },
];

export default function VaultTabs({ activeTab, onTabChange }: VaultTabsProps) {
  return (
    <div className="mb-8 border-b border-[var(--border-subtle)] px-4 sm:px-6 md:px-0">
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain flex-nowrap scrollbar-hide [-webkit-overflow-scrolling:touch]">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`shrink-0 px-4 sm:px-6 py-4 text-base font-medium transition-colors relative cursor-pointer touch-manipulation ${
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
    </div>
  );
}

