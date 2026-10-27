'use client';

import type { ReactNode } from 'react';

export interface VaultSectionLink {
  id: string;
  label: string;
}

/** Sticky jump links between the Overview sections (the app scrolls inside `[data-app-scroll]`). */
export function VaultSectionNav({ sections }: { sections: readonly VaultSectionLink[] }) {
  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      aria-label="Overview sections"
      className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-[var(--background)]/95 backdrop-blur-sm"
    >
      <div className="flex gap-1 overflow-x-auto overscroll-x-contain flex-nowrap scrollbar-hide [-webkit-overflow-scrolling:touch]">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => jumpTo(section.id)}
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg text-[var(--foreground-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer touch-manipulation"
          >
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** One Overview section: a heading, an optional one-line summary, then its content. */
export function VaultSection({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-14 space-y-3 min-w-0">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
          {title}
        </h2>
        {summary ? (
          <p className="text-sm text-[var(--foreground-secondary)] max-w-3xl">{summary}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
