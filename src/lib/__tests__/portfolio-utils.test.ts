import { describe, expect, it } from 'vitest';
import { aggregatePortfolioHistory } from '@/lib/portfolio-utils';

describe('aggregatePortfolioHistory', () => {
  it('forward-fills each vault and sums USD', () => {
    const merged = aggregatePortfolioHistory([
      [
        { timestamp: 1, assetsUsd: 10 },
        { timestamp: 3, assetsUsd: 12 },
      ],
      [{ timestamp: 2, assetsUsd: 5 }],
    ]);
    expect(merged).toEqual([
      { timestamp: 1, assetsUsd: 10 },
      { timestamp: 2, assetsUsd: 15 },
      { timestamp: 3, assetsUsd: 17 },
    ]);
  });
});
