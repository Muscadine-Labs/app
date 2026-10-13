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

export interface VaultPositionSeriesPoint {
  timestamp: number;
  assets: number;
  assetsUsd: number;
  shares: number;
  assetsRaw?: string;
}

function rawToBigInt(value: string | undefined): bigint {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

function seriesPointIsPositive(point: VaultPositionSeriesPoint): boolean {
  if (point.assets > 0 || point.assetsUsd > 0) return true;
  return point.assetsRaw !== undefined && point.assetsRaw !== '0';
}

function heldAmountIsPositive(assets: number, assetsUsd: number, assetsRaw: bigint): boolean {
  return assets > 0 || assetsUsd > 0 || assetsRaw > BigInt(0);
}

/**
 * Sum a registry vault's and its retired wrapper's position series.
 * A series keeps its last value until its next point. When that next point is
 * zero and the other contract is already positive, the stale balance is left
 * out, so a move does not draw both contracts at once. A zero that only exists
 * because the destination contract's first point is in the next bucket is
 * omitted. A real exit stays at zero, including a later deposit back into the
 * same contract. A single series is returned unchanged. Share balances are not
 * added: the two contracts mint different share tokens.
 */
export function mergeVaultPositionSeries(
  histories: VaultPositionSeriesPoint[][]
): VaultPositionSeriesPoint[] {
  const series = histories
    .filter((history) => history.length > 0)
    .map((history) => [...history].sort((a, b) => a.timestamp - b.timestamp));

  if (series.length === 0) return [];
  if (series.length === 1) return series[0];

  const timestamps = new Set<number>();
  for (const history of series) {
    for (const point of history) timestamps.add(point.timestamp);
  }

  const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);
  const lastAssets = new Array<number>(series.length).fill(0);
  const lastAssetsUsd = new Array<number>(series.length).fill(0);
  const lastAssetsRaw = new Array<bigint>(series.length).fill(BigInt(0));
  const index = new Array<number>(series.length).fill(0);

  const merged: VaultPositionSeriesPoint[] = [];

  for (const timestamp of sortedTimestamps) {
    const beforeRaw = lastAssetsRaw.slice();

    for (let i = 0; i < series.length; i++) {
      const history = series[i];
      while (index[i] < history.length && history[index[i]].timestamp <= timestamp) {
        const point = history[index[i]];
        lastAssets[i] = point.assets;
        lastAssetsUsd[i] = point.assetsUsd;
        lastAssetsRaw[i] = rawToBigInt(point.assetsRaw);
        index[i]++;
      }
    }

    const contributionRaw = lastAssetsRaw.map((raw, i) => {
      const next = series[i][index[i]];
      const staleUntilZero =
        next !== undefined &&
        !seriesPointIsPositive(next) &&
        heldAmountIsPositive(lastAssets[i], lastAssetsUsd[i], raw) &&
        lastAssetsRaw.some(
          (other, j) =>
            j !== i && heldAmountIsPositive(lastAssets[j], lastAssetsUsd[j], other)
        );
      return staleUntilZero ? BigInt(0) : raw;
    });

    const totalRaw = contributionRaw.reduce((sum, raw) => sum + raw, BigInt(0));
    const leavingForOtherContract =
      totalRaw === BigInt(0) &&
      beforeRaw.some((raw, i) => {
        if (raw <= BigInt(0) || contributionRaw[i] !== BigInt(0)) return false;
        return series.some((history, j) => {
          if (j === i || beforeRaw[j] > BigInt(0)) return false;
          const next = history[index[j]];
          return next !== undefined && seriesPointIsPositive(next);
        });
      });
    if (leavingForOtherContract) continue;

    let assets = 0;
    let assetsUsd = 0;
    let assetsRaw = BigInt(0);
    for (let i = 0; i < series.length; i++) {
      if (contributionRaw[i] === BigInt(0) && lastAssetsRaw[i] !== BigInt(0)) continue;
      assets += lastAssets[i];
      assetsUsd += lastAssetsUsd[i];
      assetsRaw += lastAssetsRaw[i];
    }

    merged.push({
      timestamp,
      assets,
      assetsUsd,
      shares: 0,
      assetsRaw: assetsRaw.toString(),
    });
  }

  return merged;
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
