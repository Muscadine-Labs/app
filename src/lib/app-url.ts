function normalizeAppOrigin(url: string): string {
  return url.replace(/\/$/, '');
}

/** Vercel sets this on every deployment (server side): the project's production domain, no scheme. */
function vercelProductionOrigin(): string | null {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host.replace(/\/$/, '')}` : null;
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

  // SSR / build: the Vercel production domain, else the local dev server.
  return vercelProductionOrigin() ?? 'http://localhost:3000';
}
