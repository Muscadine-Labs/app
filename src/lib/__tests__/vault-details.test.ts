import { describe, expect, it } from 'vitest';
import {
  formatSharePercent,
  formatTimelockDuration,
  isAllocationDust,
  groupTimelocks,
  maxRateToAnnualPercent,
  summarizeExposure,
} from '@/lib/vault-details';
import type { VaultMarketAllocation } from '@/lib/vault-v2-allocations';
import type { VaultTimelock } from '@/types/vault';

const DAY = 86_400;

function timelock(functionName: string, duration: number, abdicated = false): VaultTimelock {
  return { functionName, duration, abdicated };
}

function marketRow(collateralSymbol: string, allocatedUsd: number): VaultMarketAllocation {
  return {
    id: `${collateralSymbol}-${allocatedUsd}`,
    kind: 'market',
    name: `${collateralSymbol} / USDC`,
    allocatedUsd,
    marketSizeUsd: null,
    liquidityUsd: null,
    apy: null,
    allocatedAssetsRaw: '0',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    collateralSymbol,
  };
}

describe('formatTimelockDuration', () => {
  it('prefers whole days, then hours', () => {
    expect(formatTimelockDuration(7 * DAY)).toBe('7 days');
    expect(formatTimelockDuration(DAY)).toBe('1 day');
    expect(formatTimelockDuration(6 * 3_600)).toBe('6 hours');
    expect(formatTimelockDuration(0)).toBe('No delay');
  });
});

describe('groupTimelocks', () => {
  it('orders longest first and puts abdicated functions last', () => {
    const groups = groupTimelocks([
      timelock('setPerformanceFee', 3 * DAY),
      timelock('addAdapter', 7 * DAY),
      timelock('setAdapterRegistry', 0, true),
      timelock('increaseAbsoluteCap', 7 * DAY),
      timelock('setReceiveAssetsGate', 0),
      timelock('decreaseTimelock', 0),
      timelock('decreaseTimelock', 0, true),
    ]);
    expect(groups).toEqual([
      { label: '7 days', functions: ['addAdapter', 'increaseAbsoluteCap'] },
      { label: '3 days', functions: ['setPerformanceFee'] },
      { label: 'No delay', functions: ['setReceiveAssetsGate'] },
      { label: 'Abdicated', functions: ['setAdapterRegistry'] },
    ]);
  });
});

describe('maxRateToAnnualPercent', () => {
  it('converts a per-second WAD rate to a yearly percent', () => {
    // Muscadine vaults: 63419583650 per second ≈ 200% a year.
    expect(maxRateToAnnualPercent('63419583650')).toBe(200);
    expect(maxRateToAnnualPercent('0')).toBe(0);
    expect(maxRateToAnnualPercent(null)).toBeNull();
    expect(maxRateToAnnualPercent('not a number')).toBeNull();
  });
});

describe('summarizeExposure', () => {
  it('groups by collateral, sorts largest first and keeps idle apart', () => {
    const summary = summarizeExposure([
      marketRow('cbLTC', 8_060),
      marketRow('cbXRP', 16_871),
      marketRow('cbHYPE', 27),
      marketRow('cbDOGE', 0),
      { ...marketRow('Idle', 1_000), kind: 'idle', collateralSymbol: undefined },
    ]);
    expect(summary.items.map((item) => item.symbol)).toEqual(['cbXRP', 'cbLTC', 'cbHYPE']);
    expect(summary.marketCount).toBe(3);
    expect(summary.idleUsd).toBe(1_000);
    expect(summary.totalUsd).toBe(25_958);
    expect(summary.items[0].share).toBeCloseTo(16_871 / 25_958);
  });

  it('merges two markets with the same collateral', () => {
    const summary = summarizeExposure([marketRow('cbBTC', 100), marketRow('cbBTC', 50)]);
    expect(summary.items).toEqual([{ symbol: 'cbBTC', usd: 150, share: 1 }]);
    expect(summary.marketCount).toBe(2);
  });
});

describe('isAllocationDust', () => {
  it('hides a cent or less and keeps anything above it', () => {
    expect(isAllocationDust(0)).toBe(true);
    expect(isAllocationDust(0.01)).toBe(true);
    expect(isAllocationDust(0.0100001)).toBe(false);
    expect(isAllocationDust(Number.NaN)).toBe(true);
  });
});

describe('formatSharePercent', () => {
  it('rounds to whole percents and marks tiny shares', () => {
    expect(formatSharePercent(0.676)).toBe('68%');
    expect(formatSharePercent(0.001)).toBe('<1%');
    expect(formatSharePercent(0)).toBe('0%');
  });
});
