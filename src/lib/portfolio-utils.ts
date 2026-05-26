export interface PositionHistoryPoint {
  timestamp: number;
  assetsUsd: number;
}

export interface PortfolioVaultHistoryInput {
  symbol: string;
  version: 'v1' | 'v2';
  history: PositionHistoryPoint[];
}

/** Normalize asset symbols so v1/v2 pairs group correctly (USDC, cbBTC, WETH). */
function normalizeAssetSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper === 'CBBTC' || upper === 'CBTC' || upper === 'BTC') return 'CBBTC';
  if (upper === 'WETH' || upper === 'ETH') return 'WETH';
  if (upper === 'USDC') return 'USDC';
  return upper;
}

/**
 * Avoid double-counting when a user migrates from MetaMorpho (v1) to Prime (v2).
 * Morpho v1 history often stays non-zero after withdrawal; forward-fill would
 * stack v1 + v2 balances for the same asset. Truncate v1 at the first v2 deposit.
 */
export function preparePortfolioVaultHistories(
  vaults: PortfolioVaultHistoryInput[]
): PositionHistoryPoint[][] {
  const bySymbol = new Map<string, PortfolioVaultHistoryInput[]>();

  for (const vault of vaults) {
    const key = normalizeAssetSymbol(vault.symbol);
    const group = bySymbol.get(key) ?? [];
    group.push(vault);
    bySymbol.set(key, group);
  }

  const prepared: PositionHistoryPoint[][] = [];

  for (const group of bySymbol.values()) {
    const v2Vault = group.find((v) => v.version === 'v2');
    let v2CutoverTimestamp: number | null = null;

    if (v2Vault) {
      const firstV2Deposit = v2Vault.history
        .filter((p) => p.assetsUsd > 0)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (firstV2Deposit) {
        v2CutoverTimestamp = firstV2Deposit.timestamp;
      }
    }

    for (const vault of group) {
      let history = vault.history;
      if (vault.version === 'v1' && v2CutoverTimestamp !== null) {
        history = history.filter((p) => p.timestamp < v2CutoverTimestamp!);
        // Zero out v1 forward-fill once Prime (v2) deposits begin — v1 history often
        // stays non-zero after withdrawal, which would double-count with v2.
        history.push({ timestamp: v2CutoverTimestamp, assetsUsd: 0 });
      }
      if (history.length > 0) {
        prepared.push(history);
      }
    }
  }

  return prepared;
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
