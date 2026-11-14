/**
 * Short client cache for `/api/vault/v2/{address}/position-history` responses.
 *
 * The route is per wallet and uncached on the server (it reads Morpho on every call), and the
 * dashboard chart and the vault page both load it on mount. Without this, moving between them
 * re-downloads every vault's history each time. Entries live `POSITION_HISTORY_CACHE_MS`; in-flight
 * requests are shared; failures are not kept. `clearPositionHistoryCache()` runs on every wallet
 * balance refresh (including after a transaction), so a new deposit or withdrawal is never hidden.
 */

export const POSITION_HISTORY_CACHE_MS = 60_000;

type Entry = { at: number; promise: Promise<unknown | null> };

const cache = new Map<string, Entry>();

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Parsed JSON body, or null when the request failed or returned a non-2xx status. */
export function fetchPositionHistoryJson(
  url: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<unknown | null> {
  const now = Date.now();
  const hit = cache.get(url);
  let promise = hit && now - hit.at < POSITION_HISTORY_CACHE_MS ? hit.promise : undefined;
  if (!promise) {
    // Not tied to the caller's signal: another caller may be sharing this request.
    promise = fetcher(url, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json().catch(() => null) : null))
      .catch(() => null);
    const entry: Entry = { at: now, promise };
    cache.set(url, entry);
    void promise.then((body) => {
      if (body == null && cache.get(url) === entry) cache.delete(url);
    });
  }
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  const shared = promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    void shared.then((body) => {
      signal.removeEventListener('abort', onAbort);
      resolve(body);
    });
  });
}

export function clearPositionHistoryCache(): void {
  cache.clear();
}
