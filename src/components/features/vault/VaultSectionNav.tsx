'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface VaultSectionLink {
  id: string;
  label: string;
}

/** A section counts as current once its top passes this far below the scroll top (the nav's height). */
const ACTIVE_OFFSET_PX = 64;

/** Last section whose top has scrolled past the nav; the last one when the page is at its bottom. */
function findActiveSection(sections: readonly VaultSectionLink[], scroller: HTMLElement | null): string {
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  const atBottom = scroller
    ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
    : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atBottom) return sections[sections.length - 1]?.id ?? '';
  let active = sections[0]?.id ?? '';
  for (const section of sections) {
    const element = document.getElementById(section.id);
    if (element && element.getBoundingClientRect().top - top <= ACTIVE_OFFSET_PX) active = section.id;
  }
  return active;
}

/**
 * Sticky jump links between the Overview sections, with the section in view highlighted.
 * The app scrolls inside `[data-app-scroll]`. Hidden on phones, where the page is short
 * enough to scroll.
 */
export function VaultSectionNav({ sections }: { sections: readonly VaultSectionLink[] }) {
  const navRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const scroller = navRef.current?.closest<HTMLElement>('[data-app-scroll]') ?? null;
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActiveId(findActiveSection(sections, scroller)));
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
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Overview sections"
      className="hidden sm:block sticky top-0 z-20 -mx-1 px-1 py-2 bg-[var(--background)]/95 backdrop-blur-sm"
    >
      <div className="flex gap-1 overflow-x-auto overscroll-x-contain flex-nowrap scrollbar-hide [-webkit-overflow-scrolling:touch]">
        {sections.map((section) => {
          const active = section.id === activeId;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => jumpTo(section.id)}
              aria-current={active ? 'location' : undefined}
              className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer touch-manipulation ${
                active
                  ? 'text-[var(--foreground)] bg-[var(--surface-hover)]'
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
