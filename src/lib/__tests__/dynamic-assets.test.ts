import { afterEach, describe, expect, it } from 'vitest';
import { buildRegistryAssets, fallbackRegistryAssets, withFallbackAssets } from '@/lib/registry-assets';
import { mapMorphoAssetPrices, parsePriceAddresses, MAX_PRICE_ADDRESSES } from '@/lib/token-prices';
import {
  registerTokenLogo,
  registerTokenMetadata,
  resetTokenMetadataForTests,
  tokenLogoForSymbol,
} from '@/lib/token-metadata';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';
import { findTokenBySymbol } from '@/lib/transaction-form-utils';
import { getVaultLogo } from '@/types/vault';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const NEW_TOKEN = '0x1111111111111111111111111111111111111111';
const VAULT_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VAULT_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const VAULT_C = '0xcccccccccccccccccccccccccccccccccccccccc';

afterEach(() => resetTokenMetadataForTests());

describe('buildRegistryAssets', () => {
  it('maps each vault to its asset and lists each asset once', () => {
    const result = buildRegistryAssets(
      [{ address: VAULT_A }, { address: VAULT_B }, { address: VAULT_C }],
      [USDC, NEW_TOKEN, USDC.toLowerCase()],
      {
        [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
        [NEW_TOKEN]: { symbol: 'NEW', decimals: 12 },
      }
    );
    expect(result.assets.map((a) => a.symbol)).toEqual(['USDC', 'NEW']);
    expect(result.byVault[VAULT_B]).toMatchObject({ symbol: 'NEW', decimals: 12 });
    expect(result.byVault[VAULT_C].address).toBe(USDC);
  });

  it('skips a vault whose asset metadata is missing', () => {
    const result = buildRegistryAssets([{ address: VAULT_A }], [NEW_TOKEN], {});
    expect(result.assets).toEqual([]);
    expect(result.byVault[VAULT_A]).toBeUndefined();
    expect(result.complete).toBe(false);
  });

  it('marks a read with an unreadable vault as incomplete but keeps the others', () => {
    const result = buildRegistryAssets([{ address: VAULT_A }, { address: VAULT_B }], [null, USDC], {
      [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
    });
    expect(result.complete).toBe(false);
    expect(result.byVault[VAULT_B].symbol).toBe('USDC');
  });

  it('fills vaults a partial read missed from the fallback, keeping what it read', () => {
    const partial = buildRegistryAssets([{ address: VAULT_A }, { address: VAULT_B }], [NEW_TOKEN, null], {
      [NEW_TOKEN]: { symbol: 'NEW', decimals: 12 },
    });
    const merged = withFallbackAssets(
      partial,
      fallbackRegistryAssets([
        { address: VAULT_A, symbol: 'USDC' },
        { address: VAULT_B, symbol: 'USDC' },
      ])
    );
    expect(merged.byVault[VAULT_A].symbol).toBe('NEW');
    expect(merged.byVault[VAULT_B].address).toBe(USDC);
    expect(merged.assets.map((a) => a.symbol)).toEqual(['NEW', 'USDC', 'WETH']);
    const complete = buildRegistryAssets([{ address: VAULT_A }], [USDC], {
      [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
    });
    expect(withFallbackAssets(complete)).toBe(complete);
  });

  it('falls back to known Base tokens by registry label, always keeping WETH for ETH', () => {
    const fallback = fallbackRegistryAssets([
      { address: VAULT_A, symbol: 'usdc' },
      { address: VAULT_B, symbol: 'NEW' },
    ]);
    expect(fallback.complete).toBe(false);
    expect(fallback.byVault[VAULT_A].address).toBe(USDC);
    expect(fallback.byVault[VAULT_B]).toBeUndefined();
    expect(fallback.assets.map((a) => a.symbol)).toEqual(['USDC', 'WETH']);
  });
});

describe('price route helpers', () => {
  it('parses, dedupes and caps addresses', () => {
    expect(parsePriceAddresses(`${USDC}, ${USDC.toLowerCase()},nope,${WETH}`)).toEqual([USDC, WETH]);
    expect(parsePriceAddresses(null)).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`).join(',');
    expect(parsePriceAddresses(many)).toHaveLength(MAX_PRICE_ADDRESSES);
  });

  it('keeps positive prices and https logos only', () => {
    const mapped = mapMorphoAssetPrices([
      { address: USDC, price: { usd: 0.9998 }, logoURI: 'https://cdn.morpho.org/assets/logos/usdc.svg' },
      { address: NEW_TOKEN, price: { usd: 0 }, logoURI: 'http://insecure.example/logo.svg' },
      { address: 'bad', price: { usd: 5 } },
    ]);
    expect(mapped.prices).toEqual({ [USDC.toLowerCase()]: 0.9998 });
    expect(mapped.logos).toEqual({ [USDC.toLowerCase()]: 'https://cdn.morpho.org/assets/logos/usdc.svg' });
  });
});

describe('runtime token metadata', () => {
  it('drives decimals, token lookup and logos for a token the app never hardcoded', () => {
    registerTokenMetadata({ address: NEW_TOKEN, symbol: 'NEW', decimals: 12 }, ['newlabel']);
    expect(getAssetDecimalsForSymbol('NEW')).toBe(12);
    expect(getAssetDecimalsForSymbol('NEWLABEL')).toBe(12);

    const balances = [
      { address: NEW_TOKEN, symbol: 'Different', decimals: 12, balance: BigInt(5), formatted: '0', usdValue: 0 },
    ];
    expect(findTokenBySymbol('NEW', balances)?.address).toBe(NEW_TOKEN);

    expect(getVaultLogo('NEW')).toBe('/favicon.png');
    registerTokenLogo(NEW_TOKEN, 'https://cdn.morpho.org/assets/logos/new.svg');
    expect(tokenLogoForSymbol('NEW')).toBe('https://cdn.morpho.org/assets/logos/new.svg');
    expect(getVaultLogo('NEW')).toBe('https://cdn.morpho.org/assets/logos/new.svg');
    expect(getVaultLogo('USDC')).toBe('/usdc-logo.svg');
  });

  it('falls back to built-in decimals when nothing is registered', () => {
    expect(getAssetDecimalsForSymbol('USDC')).toBe(6);
    expect(getAssetDecimalsForSymbol('cbBTC')).toBe(8);
  });
});
