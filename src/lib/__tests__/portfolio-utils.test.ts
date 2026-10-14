import { describe, expect, it } from 'vitest';
import { mergeVaultPositionSeries, type VaultPositionSeriesPoint } from '@/lib/portfolio-utils';

const point = (timestamp: number, assets: number): VaultPositionSeriesPoint => ({
  timestamp,
  assets,
  assetsUsd: assets,
  shares: 0,
  assetsRaw: String(assets),
});

describe('mergeVaultPositionSeries', () => {
  it('returns a single series unchanged', () => {
    const series = [point(1, 10), point(2, 11)];
    expect(mergeVaultPositionSeries([series, []])).toEqual(series);
  });

  it('sums both contracts while both are held', () => {
    const merged = mergeVaultPositionSeries([
      [point(1, 10), point(2, 10)],
      [point(1, 5), point(2, 6)],
    ]);
    expect(merged.map((p) => p.assets)).toEqual([15, 16]);
  });

  it('has no gap or double count when funds move to the other contract', () => {
    // Underlying held until t=3, then moved to the wrapper (first point t=3).
    const merged = mergeVaultPositionSeries([
      [point(1, 100), point(2, 101), point(3, 0), point(4, 0)],
      [point(3, 101), point(4, 102)],
    ]);
    const values = merged.map((p) => p.assets);
    expect(values).toEqual([100, 101, 101, 102]);
  });
});
