import { describe, expect, it } from 'vitest';
import { sharesToAssetsAt, sharesToAssetsRaw } from '@/lib/vault-v2-historical-ratio';

const lookup = [
  { timestamp: 100, totalAssets: BigInt(1000), totalSupply: BigInt(1000) },
  { timestamp: 200, totalAssets: BigInt(1100), totalSupply: BigInt(1000) },
];

describe('sharesToAssetsAt', () => {
  it('interpolates between the indexed points around the transfer', () => {
    expect(sharesToAssetsAt(lookup, '100', 150)).toBe('105');
  });
  it('uses the nearest point at either end and rejects empty shares', () => {
    expect(sharesToAssetsAt(lookup, '100', 50)).toBe('100');
    expect(sharesToAssetsAt(lookup, '100', 500)).toBe('110');
    expect(sharesToAssetsAt(lookup, '0', 150)).toBeUndefined();
    expect(sharesToAssetsAt([], '100', 150)).toBeUndefined();
  });
});

describe('sharesToAssetsRaw', () => {
  it('values shares at the given totals', () => {
    expect(sharesToAssetsRaw('1000', { totalAssets: BigInt(1040), totalSupply: BigInt(1000) })).toBe('1040');
  });
});
