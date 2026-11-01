import { describe, expect, it } from 'vitest';
import { timeWeightedAverage } from '@/lib/chart-utils';

describe('timeWeightedAverage', () => {
  it('returns null for no usable points and the value for one point', () => {
    expect(timeWeightedAverage([])).toBeNull();
    expect(timeWeightedAverage([{ timestamp: 1, value: Number.NaN }])).toBeNull();
    expect(timeWeightedAverage([{ timestamp: 1, value: 4 }])).toBe(4);
  });

  it('equals the plain mean for evenly spaced points', () => {
    const points = [2, 4, 6].map((value, i) => ({ timestamp: i * 3600, value }));
    expect(timeWeightedAverage(points)).toBeCloseTo(4);
  });

  it('weights a point by how long it held', () => {
    // 2% for 3 days, then 8% for 1 day (last point holds for the interval before it).
    const points = [
      { timestamp: 0, value: 2 },
      { timestamp: 3 * 86400, value: 8 },
    ];
    expect(timeWeightedAverage(points)).toBeCloseTo((2 * 3 + 8 * 3) / 6);
    const gapped = [
      { timestamp: 0, value: 2 },
      { timestamp: 3 * 86400, value: 8 },
      { timestamp: 4 * 86400, value: 8 },
    ];
    expect(timeWeightedAverage(gapped)).toBeCloseTo((2 * 3 + 8 * 1 + 8 * 1) / 5);
  });

  it('ignores order', () => {
    const points = [
      { timestamp: 7200, value: 6 },
      { timestamp: 0, value: 2 },
      { timestamp: 3600, value: 4 },
    ];
    expect(timeWeightedAverage(points)).toBeCloseTo(4);
  });
});

describe('evenTimeTicks', () => {
  const DAY = 86_400;
  // A local midnight, so expectations do not depend on the test machine's time zone.
  const midnight = (() => {
    const d = new Date(2026, 0, 10);
    return Math.floor(d.getTime() / 1000);
  })();

  it('spaces ticks by equal calendar days within the limit', async () => {
    const { evenTimeTicks } = await import('@/lib/chart-utils');
    const ticks = evenTimeTicks(midnight, midnight + 30 * DAY, 8);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const steps = ticks.slice(1).map((t, i) => Math.round((t - ticks[i]) / DAY));
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBe(7);
  });

  it('starts at the first local midnight at or after start and stays in range', async () => {
    const { evenTimeTicks } = await import('@/lib/chart-utils');
    const start = midnight + 5 * 3600;
    const end = start + 7 * DAY;
    const ticks = evenTimeTicks(start, end, 12);
    expect(ticks[0]).toBe(midnight + DAY);
    expect(ticks.every((t) => t >= start && t <= end)).toBe(true);
    expect(new Date(ticks[0] * 1000).getHours()).toBe(0);
  });

  it('uses bigger steps for long spans and handles bad input', async () => {
    const { evenTimeTicks, maxTimeTicksForWidth } = await import('@/lib/chart-utils');
    const ticks = evenTimeTicks(midnight, midnight + 400 * DAY, 6);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(Math.round((ticks[1] - ticks[0]) / DAY)).toBe(90);
    expect(evenTimeTicks(10, 5, 6)).toEqual([]);
    expect(maxTimeTicksForWidth(0)).toBe(6);
    expect(maxTimeTicksForWidth(320)).toBe(5);
    expect(maxTimeTicksForWidth(5000)).toBe(12);
  });
});
