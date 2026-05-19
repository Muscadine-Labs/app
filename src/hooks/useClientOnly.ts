import { useSyncExternalStore } from 'react';

/** True on the client after hydration; false during SSR. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/** Current Unix timestamp (seconds). Safe for render under react-hooks/purity. */
export function useUnixTimestamp(): number {
  return useSyncExternalStore(
    () => () => {},
    () => Math.floor(Date.now() / 1000),
    () => 0
  );
}
