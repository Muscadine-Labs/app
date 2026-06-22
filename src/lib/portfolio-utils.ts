import {
  isLegacyMuscadineV1Vault,
  normalizePortfolioAssetSymbol,
} from '@/lib/legacy-vaults';
import { findVaultByAddress } from '@/lib/vault-utils';

export interface PositionHistoryPoint {
  timestamp: number;
  assetsUsd: number;
}

export interface PortfolioVaultHistoryInput {
  address: string;
  symbol: string;
  version: 'v1' | 'v2';
  history: PositionHistoryPoint[];
}

/**
 * Prepare per-vault histories for portfolio aggregation.
 *
 * Cutover (truncate v1 at first related v2 deposit) applies only to known Muscadine
 * v1→v2 migration pairs — not external v1/v2 vaults that share the same asset symbol.
 */
export function preparePortfolioVaultHistories(
  vaults: PortfolioVaultHistoryInput[]
): PositionHistoryPoint[][] {
  const prepared: PositionHistoryPoint[][] = [];
  const v2Vaults = vaults.filter((v) => v.version === 'v2');

  for (const vault of vaults) {
    let history = vault.history;

    if (
      vault.version === 'v1' &&
      isLegacyMuscadineV1Vault(vault.address) &&
      v2Vaults.length > 0
    ) {
      const symbolKey = normalizePortfolioAssetSymbol(vault.symbol);
      const relatedV2 = v2Vaults.filter((v) => {
        if (normalizePortfolioAssetSymbol(v.symbol) !== symbolKey) return false;
        return Boolean(findVaultByAddress(v.address));
      });

      if (relatedV2.length > 0) {
        const firstV2Deposit = relatedV2
          .flatMap((v) => v.history.filter((p) => p.assetsUsd > 0))
          .sort((a, b) => a.timestamp - b.timestamp)[0];

        if (firstV2Deposit) {
          const cutover = firstV2Deposit.timestamp;
          history = history.filter((p) => p.timestamp < cutover);
          history.push({ timestamp: cutover, assetsUsd: 0 });
        }
      }
    }

    if (history.length > 0) {
      prepared.push(history);
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
