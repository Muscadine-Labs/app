import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/types/api';
import { computeEarnedInterestFromActivity, periodInterestRaw } from '@/lib/interest-utils';

const tx = (assets: string) => ({ assets }) as unknown as Transaction;

describe('computeEarnedInterestFromActivity', () => {
  it('is current + withdrawals − deposits', () => {
    expect(
      computeEarnedInterestFromActivity({
        currentAssetsRaw: BigInt(105),
        deposits: [tx('100')],
        withdrawals: [],
      })
    ).toBe(BigInt(5));
  });
  it('keeps interest taken out before a smaller re-deposit', () => {
    // Deposit 100, withdraw 110 (10 interest), re-deposit 50, now worth 52.
    expect(
      computeEarnedInterestFromActivity({
        currentAssetsRaw: BigInt(52),
        deposits: [tx('100'), tx('50')],
        withdrawals: [tx('110')],
      })
    ).toBe(BigInt(12));
  });
  it('floors a net loss at zero', () => {
    expect(
      computeEarnedInterestFromActivity({
        currentAssetsRaw: BigInt(90),
        deposits: [tx('100')],
        withdrawals: [],
      })
    ).toBe(BigInt(0));
  });
});

describe('periodInterestRaw', () => {
  const nowTs = 1_000_000;
  const periodSeconds = 1_000;

  it('hides the row when the wallet never held a position', () => {
    expect(
      periodInterestRaw({
        nowTs,
        periodSeconds,
        firstPositionTs: null,
        startPositionRaw: BigInt(0),
        currentPositionRaw: BigInt(0),
        events: [],
      }).hidden
    ).toBe(true);
  });

  it('subtracts flows inside the window only', () => {
    const result = periodInterestRaw({
      nowTs,
      periodSeconds,
      firstPositionTs: 1,
      startPositionRaw: BigInt(100),
      currentPositionRaw: BigInt(160),
      events: [
        { timestamp: 10, deltaRaw: BigInt(100) }, // before the window
        { timestamp: nowTs - 10, deltaRaw: BigInt(50) },
      ],
    });
    expect(result).toEqual({ hidden: false, earnedRaw: BigInt(10) });
  });

  it('does not count earlier interest after a round trip', () => {
    // Withdrew more than deposited long ago; window only sees its own growth.
    const result = periodInterestRaw({
      nowTs,
      periodSeconds,
      firstPositionTs: 1,
      startPositionRaw: BigInt(50),
      currentPositionRaw: BigInt(51),
      events: [
        { timestamp: 10, deltaRaw: BigInt(100) },
        { timestamp: 20, deltaRaw: BigInt(-200) },
        { timestamp: 30, deltaRaw: BigInt(50) },
      ],
    });
    expect(result.earnedRaw).toBe(BigInt(1));
  });
});
