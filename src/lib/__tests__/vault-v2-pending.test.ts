import { describe, expect, it } from 'vitest';
import { mapVaultV2Pending } from '@/lib/vault-v2-pending';
import { formatTimeUntil } from '@/lib/vault-details';

const WAD = 1e18;

describe('mapVaultV2Pending', () => {
  it('describes each pending change with a direction', () => {
    const changes = mapVaultV2Pending({
      performanceFee: 0.05,
      managementFee: 0,
      caps: {
        items: [
          {
            id: '0xABC',
            data: { market: { collateralAsset: { symbol: 'cbXRP' }, loanAsset: { symbol: 'USDC' } } },
          },
        ],
      },
      pendingConfigs: {
        items: [
          {
            functionName: 'setPerformanceFee',
            txHash: '0x1',
            validAt: 300,
            decodedData: { performanceFee: String(0.1 * WAD) },
          },
          {
            functionName: 'increaseAbsoluteCap',
            txHash: '0x2',
            validAt: 200,
            decodedData: { cap: '1', config: { id: '0xabc', type: 'MarketV1' } },
          },
          { functionName: 'removeAdapter', txHash: '0x3', validAt: 100, decodedData: {} },
          {
            functionName: 'setManagementFee',
            txHash: '0x4',
            validAt: 400,
            decodedData: { managementFee: '0' },
          },
          {
            functionName: 'increaseRelativeCap',
            txHash: '0x5',
            validAt: 0,
            decodedData: { config: { id: '0xnew', type: 'Collateral' } },
          },
        ],
      },
    });

    expect(changes.map((change) => [change.direction, change.title])).toEqual([
      ['remove', 'Remove an adapter'],
      ['add', 'Raise the cap on the cbXRP / USDC market'],
      ['add', 'Set the performance fee to 10%'],
      ['change', 'Set the management fee to 0%'],
      ['add', 'Raise the cap on a collateral token'],
    ]);
  });

  it('marks a fee cut and an allocator removal as removals', () => {
    const changes = mapVaultV2Pending({
      performanceFee: 0.1,
      pendingConfigs: {
        items: [
          { functionName: 'setPerformanceFee', validAt: 1, decodedData: { performanceFee: String(0.05 * WAD) } },
          { functionName: 'setIsAllocator', validAt: 2, decodedData: { isAllocator: false } },
        ],
      },
    });
    expect(changes.map((change) => change.direction)).toEqual(['remove', 'remove']);
    expect(changes[1].title).toBe('Remove an allocator');
  });

  it('returns nothing when no change is pending', () => {
    expect(mapVaultV2Pending({ pendingConfigs: { items: [] } })).toEqual([]);
  });
});

describe('formatTimeUntil', () => {
  it('counts down in days, hours or minutes', () => {
    expect(formatTimeUntil(1_000 + 3 * 86_400 + 5, 1_000)).toBe('Takes effect in 3 days');
    expect(formatTimeUntil(1_000 + 5 * 86_400 - 30, 1_000)).toBe('Takes effect in 5 days');
    expect(formatTimeUntil(1_000 + 7_200, 1_000)).toBe('Takes effect in 2 hours');
    expect(formatTimeUntil(1_000 + 90, 1_000)).toBe('Takes effect in 2 minutes');
    expect(formatTimeUntil(900, 1_000)).toBe('Can take effect now');
    expect(formatTimeUntil(0, 1_000)).toBe('Waiting on its timelock');
  });
});
