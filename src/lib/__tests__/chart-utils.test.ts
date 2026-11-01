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
