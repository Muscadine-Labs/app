export interface PositionHistoryPoint {
  timestamp: number;
  assetsUsd: number;
}

/**
 * Aggregate multiple vault position histories into a combined USD portfolio series.
 * Uses forward-fill so each vault contributes its last known value at each timestamp.
 */
export function aggregatePortfolioHistory(
  histories: PositionHistoryPoint[][]
): PositionHistoryPoint[] {
  if (histories.length === 0) return [];

  const vaultSeries = histories
    .filter((history) => history.length > 0)
    .map((history) => [...history].sort((a, b) => a.timestamp - b.timestamp));

  if (vaultSeries.length === 0) return [];

  const allTimestamps = new Set<number>();
  vaultSeries.forEach((series) => {
    series.forEach((point) => allTimestamps.add(point.timestamp));
  });

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
  const lastKnown = new Array(vaultSeries.length).fill(0);
  const vaultIndices = new Array(vaultSeries.length).fill(0);

  return sortedTimestamps.map((timestamp) => {
    let total = 0;

    for (let i = 0; i < vaultSeries.length; i++) {
      const series = vaultSeries[i];
      while (
        vaultIndices[i] < series.length &&
        series[vaultIndices[i]].timestamp <= timestamp
      ) {
        lastKnown[i] = series[vaultIndices[i]].assetsUsd;
        vaultIndices[i]++;
      }
      total += lastKnown[i];
    }

    return { timestamp, assetsUsd: total };
  });
}

export function mapPortfolioHistoryToChartData(
  history: PositionHistoryPoint[],
  formatDate: (timestamp: number) => string
) {
  return history.map((point) => ({
    timestamp: point.timestamp,
    date: formatDate(point.timestamp),
    valueUsd: Math.max(0, point.assetsUsd),
    value: Math.max(0, point.assetsUsd),
  }));
}
