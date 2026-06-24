'use client';

import { useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { logger } from '@/lib/logger';

/**
 * Mini App SDK Initialization
 * Calls ready() to hide the loading splash screen and display the app
 */
export function MiniAppInit() {
  useEffect(() => {
    const initializeSDK = async () => {
      try {
        await sdk.actions.ready();
      } catch (error) {
        logger.warn(
          'MiniApp SDK ready() failed (expected outside Farcaster/Base mini app host)',
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    };

    initializeSDK();
  }, []);

  return null;
}

