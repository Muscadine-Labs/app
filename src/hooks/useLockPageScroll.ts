'use client';

import { useEffect } from 'react';

/** Locks body + main app scroll container while overlays/menus are open. */
export function useLockPageScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const scrollEl = document.querySelector('[data-app-scroll]') as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    if (scrollEl) scrollEl.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = '';
      if (scrollEl) scrollEl.style.overflow = '';
    };
  }, [locked]);
}
