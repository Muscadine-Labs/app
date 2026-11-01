import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMorphoGraphQL } from '@/lib/api-utils';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const rateLimited = (retryAfter?: string) =>
  new Response('{"errors":[{"message":"Too many requests"}]}', {
    status: 429,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  });

describe('fetchMorphoGraphQL cache and retries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('serves an expired entry with the same cacheKey when Morpho rate-limits', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: { v: 1 } }))
      .mockResolvedValue(rateLimited('3600'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchMorphoGraphQL(
      { query: 'q', variables: { end: 1 } },
      { cacheKey: 'stale-test' }
    );
    expect(await first.json()).toEqual({ data: { v: 1 } });

    // Past the 60s TTL, inside the stale window; the body differs (new endTimestamp).
    vi.setSystemTime(Date.now() + 5 * 60_000);
    const second = await fetchMorphoGraphQL(
      { query: 'q', variables: { end: 2 } },
      { cacheKey: 'stale-test' }
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ data: { v: 1 } });
  });

  it('gives up at once on a long Retry-After instead of sleeping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rateLimited('60'));
    vi.stubGlobal('fetch', fetchMock);

    const started = performance.now();
    const res = await fetchMorphoGraphQL({ query: 'long-retry' }, { skipMemoryCache: true });
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
