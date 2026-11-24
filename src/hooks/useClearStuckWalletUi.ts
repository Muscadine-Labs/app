'use client';

import { useEffect } from 'react';
import { isPageScrollLocked } from '@/hooks/useLockPageScroll';

/**
 * Returning to the Base App WebView can leave a WalletConnect / Reown AppKit
 * overlay covering the page (looks blank until the iframe remounts).
 * On pageshow, drop leftover WC chrome and unlock body scroll if no dialog
 * is actually open.
 */
export function useClearStuckWalletUi() {
  useEffect(() => {
    const restore = () => {
      // AppKit 2 marks an open modal with the `open` class (its `open` is Lit state, not an
      // attribute); the attribute selectors cover older WalletConnect modals.
      const dialogOpen = Boolean(
        document.querySelector(
          'w3m-modal.open, appkit-modal.open, w3m-modal[open], appkit-modal[open], wcm-modal[open]'
        )
      );
      if (dialogOpen || isPageScrollLocked()) return;

      // AppKit's scroll lock is a <style> tag (body touch-action/overflow); a modal torn down
      // while the WebView was in the background can leave it behind.
      document.head.querySelectorAll('style[data-w3m="scroll-lock"]').forEach((tag) => tag.remove());

      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('pointer-events');
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('pointer-events');
    };

    const onReturn = () => {
      window.setTimeout(restore, 50);
    };

    restore();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);

    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
    };
  }, []);
}
