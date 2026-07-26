function normalizeAppOrigin(url: string): string {
  return url.replace(/\/$/, '');
}

/** Public app origin for metadata, WalletConnect, and Base Account (appUrl). */
export function getAppUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (fromEnv) {
    return normalizeAppOrigin(fromEnv);
  }

  // Client: always match the live page origin (WalletConnect metadata must match).
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // SSR / build: dev default; production fallback when env unset.
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }

  return 'https://app.muscadine.xyz';
}
