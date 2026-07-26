'use client';

import { type ReactNode } from 'react';
import { useIsClient } from '@/hooks/useClientOnly';

/**
 * Defers rendering until client mount — avoids blank flash / hydration mismatch
 * in Base App and other embedded WebViews before wagmi/RainbowKit initialize.
 */
export function ClientHydrated({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const mounted = useIsClient();

  if (!mounted) {
    return (
      fallback ?? (
        <div
          className="min-h-screen w-full bg-[var(--background)]"
          aria-hidden="true"
        />
      )
    );
  }

  return <>{children}</>;
}
