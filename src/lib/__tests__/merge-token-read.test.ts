import { describe, expect, it } from 'vitest';
import { mergeTokenRead } from '@/contexts/WalletContext';

const tok = (address: string, balance: bigint) => ({
  address,
  symbol: 'T',
  decimals: 6,
  balance,
  formatted: '0',
  usdValue: 0,
});
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('mergeTokenRead', () => {
  const prev = { address: '0xw', tokens: [tok(A, BigInt(1)), tok(B, BigInt(2))] };

  it('keeps the last value of a token whose read failed', () => {
    const next = mergeTokenRead(prev, '0xw', { tokens: [tok(A, BigInt(5))], ok: false, failed: [B] });
    expect(next.tokens.map((t) => [t.address, t.balance])).toEqual([
      [A, BigInt(5)],
      [B, BigInt(2)],
    ]);
  });

  it('keeps everything on a total failure and replaces on a full read', () => {
    expect(mergeTokenRead(prev, '0xw', { tokens: [], ok: false, failed: null })).toBe(prev);
    expect(mergeTokenRead(prev, '0xw', { tokens: [], ok: true, failed: [] }).tokens).toEqual([]);
  });

  it('never keeps another wallet\'s tokens', () => {
    expect(mergeTokenRead(prev, '0xother', { tokens: [], ok: false, failed: null })).toEqual({
      address: '0xother',
      tokens: [],
    });
  });
});
