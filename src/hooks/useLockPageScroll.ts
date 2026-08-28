'use client';

import { useEffect } from 'react';

// Overlays nest (transact modal → withdraw warning modal), so the lock is
// reference counted: scrolling is only restored once the last overlay closes.
let lockCount = 0;
let previousBodyOverflow = '';
let previousScrollOverflow = '';

function getAppScrollElement(): HTMLElement | null {
  return document.querySelector('[data-app-scroll]');
}

export function isPageScrollLocked(): boolean {
  return lockCount > 0;
}

/** Locks body + main app scroll container while overlays/menus are open. */
export function useLockPageScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      const scrollEl = getAppScrollElement();
      previousBodyOverflow = document.body.style.overflow;
      previousScrollOverflow = scrollEl?.style.overflow ?? '';
      document.body.style.overflow = 'hidden';
      if (scrollEl) scrollEl.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount > 0) return;

      document.body.style.overflow = previousBodyOverflow;
      // Re-query: the element may have remounted while the overlay was open.
      const scrollEl = getAppScrollElement();
      if (scrollEl) scrollEl.style.overflow = previousScrollOverflow;
    };
  }, [locked]);
}
