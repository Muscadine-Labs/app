import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POSITION_HISTORY_CACHE_MS,
  clearPositionHistoryCache,
  markPositionHistoryTransaction,
  POST_TX_NO_CACHE_MS,
  fetchPositionHistoryJson,
} from '@/lib/position-history-cache';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('fetchPositionHistoryJson', () => {
  afterEach(() => {
    clearPositionHistoryCache();
    vi.useRealTimers();
  });

  it('shares one request between callers and reuses it inside the TTL', async () => {
    const fetcher = vi.fn(async () => okResponse({ history: [1] }));
    const [a, b] = await Promise.all([
      fetchPositionHistoryJson('/x', undefined, fetcher as unknown as typeof fetch),
      fetchPositionHistoryJson('/x', undefined, fetcher as unknown as typeof fetch),
    ]);
    expect(a).toEqual({ history: [1] });
    expect(b).toEqual({ history: [1] });
    await fetchPositionHistoryJson('/x', undefined, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL and after a clear', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => okResponse({ history: [] }));
    const f = fetcher as unknown as typeof fetch;
    await fetchPositionHistoryJson('/y', undefined, f);
    vi.advanceTimersByTime(POSITION_HISTORY_CACHE_MS + 1);
    await fetchPositionHistoryJson('/y', undefined, f);
    expect(fetcher).toHaveBeenCalledTimes(2);
    clearPositionHistoryCache();
    await fetchPositionHistoryJson('/y', undefined, f);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not keep failures', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(okResponse({ history: [2] }));
    const f = fetcher as unknown as typeof fetch;
    expect(await fetchPositionHistoryJson('/z', undefined, f)).toBeNull();
    expect(await fetchPositionHistoryJson('/z', undefined, f)).toEqual({ history: [2] });
  });

  it('does not keep an HTTP 200 body that carries an error', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ error: 'Morpho GraphQL error' }))
      .mockResolvedValueOnce(okResponse({ history: [4] }));
    const f = fetcher as unknown as typeof fetch;
    expect(await fetchPositionHistoryJson('/e', undefined, f)).toEqual({ error: 'Morpho GraphQL error' });
    await Promise.resolve();
    expect(await fetchPositionHistoryJson('/e', undefined, f)).toEqual({ history: [4] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not store results for a while after a transaction', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => okResponse({ history: [] }));
    const f = fetcher as unknown as typeof fetch;
    markPositionHistoryTransaction();
    await fetchPositionHistoryJson('/t', undefined, f);
    await fetchPositionHistoryJson('/t', undefined, f);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(POST_TX_NO_CACHE_MS + 1);
    await fetchPositionHistoryJson('/t', undefined, f);
    await fetchPositionHistoryJson('/t', undefined, f);
    expect(fetcher).toHaveBeenCalledTimes(3);
    // A window that ended long ago, so later tests cache normally.
    markPositionHistoryTransaction(0);
  });

  it('rejects an aborted caller without cancelling the shared request', async () => {
    const fetcher = vi.fn(async () => okResponse({ history: [3] }));
    const f = fetcher as unknown as typeof fetch;
    const controller = new AbortController();
    const aborted = fetchPositionHistoryJson('/w', controller.signal, f);
    const other = fetchPositionHistoryJson('/w', undefined, f);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    await expect(other).resolves.toEqual({ history: [3] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
