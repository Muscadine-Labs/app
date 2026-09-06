let initPromise: Promise<unknown> | null = null;

/** Load Reown AppKit once — deferred from the initial bundle until connect/theme sync. */
export function ensureAppKitInit(): Promise<unknown> {
  if (!initPromise) {
    initPromise = import('@/config/appkit');
  }
  return initPromise;
}
