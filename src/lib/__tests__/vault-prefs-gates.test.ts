import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAULT_PREFS,
  VAULT_PREFS_COOKIE,
  parseVaultPrefs,
  readVaultPrefsFromCookieHeader,
} from '@/lib/vault-prefs';
import { resolveDepositBlocked, resolveDepositEligibility } from '@/lib/vault-gates';
import { getRegistryVaultList } from '@/lib/vaults';

describe('vault prefs cookie', () => {
  it('defaults when missing or broken', () => {
    expect(parseVaultPrefs(undefined)).toEqual(DEFAULT_VAULT_PREFS);
    expect(parseVaultPrefs('not json')).toEqual(DEFAULT_VAULT_PREFS);
    expect(parseVaultPrefs(encodeURIComponent('{"kindMode":"bogus"}'))).toEqual(DEFAULT_VAULT_PREFS);
  });
  it('reads saved values from a Cookie header', () => {
    const value = encodeURIComponent(JSON.stringify({ kindMode: 'all', sharedData: false }));
    expect(readVaultPrefsFromCookieHeader(`a=1; ${VAULT_PREFS_COOKIE}=${value}; b=2`)).toEqual({
      kindMode: 'all',
      sharedData: false,
    });
  });
});

describe('deposit gates', () => {
  const vaults = getRegistryVaultList();
  const [first, second] = vaults;
  const a = first.address.toLowerCase();
  const b = second.address.toLowerCase();

  it('eligible only on a successful yes', () => {
    const eligible = resolveDepositEligibility(vaults, { [a]: true, [b]: false }, { [b]: true });
    expect(eligible.has(a)).toBe(true);
    expect(eligible.has(b)).toBe(true);
    expect(resolveDepositEligibility(vaults, undefined, undefined).size).toBe(0);
  });

  it('blocked only on a successful no; a failed read is never blocked', () => {
    expect(resolveDepositBlocked(vaults, { [a]: false }, { [a]: false }, true).has(a)).toBe(true);
    expect(resolveDepositBlocked(vaults, { [a]: false }, { [a]: true }, true).has(a)).toBe(false);
    expect(resolveDepositBlocked(vaults, { [a]: false }, undefined, true).has(a)).toBe(false);
    expect(resolveDepositBlocked(vaults, undefined, undefined, false).size).toBe(0);
    expect(resolveDepositBlocked(vaults, { [a]: false }, undefined, false).has(a)).toBe(true);
  });
});
