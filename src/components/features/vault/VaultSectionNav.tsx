'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface VaultSectionLink {
  id: string;
  label: string;
}

export const VAULT_OVERVIEW_SECTIONS: readonly VaultSectionLink[] = [
  { id: 'vault-performance', label: 'Performance' },
  { id: 'vault-allocation', label: 'Allocation' },
  { id: 'vault-risk', label: 'Risk' },
  { id: 'vault-details', label: 'Details' },
];

/** Space left between the bottom of the sticky header and a section it jumps to. */
const SECTION_GAP_PX = 12;

/** The app scrolls inside `[data-app-scroll]`; fall back to the window elsewhere. */
function getScroller(nav: HTMLElement | null): HTMLElement | null {
  return nav?.closest<HTMLElement>('[data-app-scroll]') ?? null;
}

/**
 * Where content starts below the sticky header once it is pinned, relative to the viewport.
 * Measured from the pinned position so jumps from the top of the page land correctly too.
 */
function contentTop(nav: HTMLElement | null): number {
  if (!nav) return SECTION_GAP_PX;
  const header = nav.closest<HTMLElement>('[data-vault-sticky-header]') ?? nav;
  const pinnedTop = getScroller(nav)?.getBoundingClientRect().top ?? 0;
  const navBottomInHeader = nav.getBoundingClientRect().bottom - header.getBoundingClientRect().top;
  return pinnedTop + navBottomInHeader + SECTION_GAP_PX;
}

/** Last section whose top has reached the header; the last one when the page is at its bottom. */
function findActiveSection(
  sections: readonly VaultSectionLink[],
  scroller: HTMLElement | null,
  nav: HTMLElement | null
): string {
  const atBottom = scroller
    ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
    : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atBottom) return sections[sections.length - 1]?.id ?? '';
  const threshold = contentTop(nav) + 1;
  let active = sections[0]?.id ?? '';
  for (const section of sections) {
    const element = document.getElementById(section.id);
    if (element && element.getBoundingClientRect().top <= threshold) active = section.id;
  }
  return active;
}

/**
 * Jump links between the Overview sections, with the section in view highlighted.
 * Rendered as the bottom row of the vault page's sticky header.
 */
export function VaultSectionNav({ sections }: { sections: readonly VaultSectionLink[] }) {
  const navRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const nav = navRef.current;
    const scroller = getScroller(nav);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActiveId(findActiveSection(sections, scroller, nav)));
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [sections]);

  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    const nav = navRef.current;
    const scroller = getScroller(nav);
    const offset = element.getBoundingClientRect().top - contentTop(nav);
    (scroller ?? window).scrollBy({ top: offset, behavior: 'smooth' });
  };

  return (
    <nav ref={navRef} aria-label="Overview sections" className="py-2">
      <div className="flex gap-1 overflow-x-auto overscroll-x-contain flex-nowrap scrollbar-hide [-webkit-overflow-scrolling:touch]">
        {sections.map((section) => {
          const active = section.id === activeId;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => jumpTo(section.id)}
              aria-current={active ? 'location' : undefined}
              className={`shrink-0 px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer touch-manipulation ${
                active
                  ? 'text-[var(--primary)] bg-[var(--primary-subtle)]'
                  : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {section.label}
            </button>
          );
        })}
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
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3 min-w-0">
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
