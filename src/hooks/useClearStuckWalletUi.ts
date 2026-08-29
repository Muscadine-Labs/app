'use client';

import { useEffect } from 'react';
import { isPageScrollLocked } from '@/hooks/useLockPageScroll';

/**
 * Returning to the Base App WebView can leave a WalletConnect / RainbowKit
 * overlay covering the page (looks blank until the iframe remounts).
 * On pageshow, drop leftover WC chrome and unlock body scroll if no dialog
 * is actually open.
 */
export function useClearStuckWalletUi() {
  useEffect(() => {
    const restore = () => {
      const dialogOpen = Boolean(
        document.querySelector('[data-rk] [role="dialog"]')
      );
      if (dialogOpen || isPageScrollLocked()) return;

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
