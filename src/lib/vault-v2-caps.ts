import { fetchMorphoGraphQL, readMorphoGraphQLResponse } from '@/lib/api-utils';
import { getMorphoMarketUrl, type MorphoMarketRateType } from '@/lib/morpho-market-url';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';

/** Vault V2 caps: per Morpho market, per collateral token, and per adapter. */
export type VaultCapKind = 'market' | 'collateral' | 'adapter';

export interface VaultCapRow {
  id: string;
  kind: VaultCapKind;
  label: string;
  /** Market LLTV as a fraction (0.625), market rows only. */
  lltv: number | null;
  /** Morpho Blue market caps are variable-rate unless the cap type says fixed. */
  rateType: MorphoMarketRateType | null;
  /** Raw vault-asset units. */
  allocationRaw: string;
  absoluteCapRaw: string;
  /** WAD-scaled (1e18 = 100%, which means no relative limit). */
  relativeCapWad: string;
  /** Morpho market page, or the token on Basescan. Adapters have none. */
  href: string | null;
}

export interface VaultCapData {
  caps: VaultCapRow[];
  assetSymbol: string;
  assetDecimals: number;
}

const VAULT_CAPS_QUERY = `
  query VaultV2Caps($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      asset { symbol decimals }
      adapters(first: 20) {
        items {
          __typename
          address
        }
      }
      caps(first: 100) {
        items {
          type
          absoluteCap
          relativeCap
          allocation
          data {
            __typename
            ... on AdapterCapData { adapterAddress }
            ... on MarketV1CapData {
              market {
                marketId
                lltv
                loanAsset { symbol }
                collateralAsset { address symbol }
              }
            }
            ... on CollateralCapData { collateralAddress }
          }
        }
      }
    }
  }
`;

type NumericLike = string | number | null | undefined;

export interface VaultCapsGraphQL {
  asset?: { symbol?: string | null; decimals?: number | null } | null;
  adapters?: {
    items?: Array<{
      __typename?: string | null;
      address?: string | null;
    } | null> | null;
  } | null;
  caps?: {
    items?: Array<{
      type?: string | null;
      absoluteCap?: NumericLike;
      relativeCap?: NumericLike;
      allocation?: NumericLike;
      data?: {
        __typename?: string | null;
        adapterAddress?: string | null;
        collateralAddress?: string | null;
        market?: {
          marketId?: string | null;
          lltv?: NumericLike;
          loanAsset?: { symbol?: string | null } | null;
          collateralAsset?: { address?: string | null; symbol?: string | null } | null;
        } | null;
      } | null;
    } | null> | null;
  } | null;
}

/** Raw integer string; JSON numbers above 2^53 arrive in exponent form. */
function toRawString(value: NumericLike): string {
  if (value === null || value === undefined || value === '') return '0';
  if (typeof value === 'string') return /^\d+$/.test(value) ? value : '0';
  if (!Number.isFinite(value) || value <= 0) return '0';
  try {
    return BigInt(Math.trunc(value)).toLocaleString('fullwide', { useGrouping: false });
  } catch {
    return '0';
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function basescanTokenUrl(address: string): string {
  return `https://basescan.org/token/${address}`;
}

const KIND_ORDER: Record<VaultCapKind, number> = { market: 0, collateral: 1, adapter: 2 };

function compareRaw(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left === right ? 0 : left > right ? -1 : 1;
}

/**
 * Readable cap rows. A cap whose absolute cap is 0 and holds nothing is a
 * removed market or token, so it is left out.
 */
export function mapVaultV2Caps(vault: VaultCapsGraphQL, chainId: number = BASE_CHAIN_ID): VaultCapData {
  const collateralSymbols = new Map<string, string>();
  for (const cap of vault.caps?.items ?? []) {
    const collateral = cap?.data?.market?.collateralAsset;
    if (collateral?.address && collateral.symbol) {
      collateralSymbols.set(collateral.address.toLowerCase(), collateral.symbol);
    }
  }
  const adapterLabels = new Map<string, string>();
  for (const adapter of vault.adapters?.items ?? []) {
    if (!adapter?.address) continue;
    const label = adapter.__typename === 'MorphoMarketV1Adapter' ? 'Morpho Blue adapter' : 'Adapter';
    adapterLabels.set(adapter.address.toLowerCase(), label);
  }

  const caps: VaultCapRow[] = [];
  (vault.caps?.items ?? []).forEach((cap, index) => {
    if (!cap?.data) return;
    const allocationRaw = toRawString(cap.allocation);
    const absoluteCapRaw = toRawString(cap.absoluteCap);
    if (absoluteCapRaw === '0' && allocationRaw === '0') return;
    const relativeCapWad = toRawString(cap.relativeCap);
    const data = cap.data;

    if (data.market) {
      const collateral = data.market.collateralAsset?.symbol ?? '?';
      const loan = data.market.loanAsset?.symbol ?? '?';
      const lltv = Number(data.market.lltv ?? 0) / 1e18;
      const rateType: MorphoMarketRateType =
        cap.type?.toLowerCase().includes('fixed') ? 'fixed' : 'variable';
      const marketId = data.market.marketId;
      caps.push({
        // Two adapters can cap the same market; the list position keeps keys unique.
        id: `market-${marketId ?? 'unknown'}-${index}`,
        kind: 'market',
        label: `${collateral} / ${loan}`,
        lltv: Number.isFinite(lltv) && lltv > 0 ? lltv : null,
        rateType,
        allocationRaw,
        absoluteCapRaw,
        relativeCapWad,
        href:
          marketId && collateral !== '?' && loan !== '?'
            ? getMorphoMarketUrl(chainId, marketId, collateral, loan, rateType)
            : null,
      });
    } else if (data.collateralAddress) {
      const address = data.collateralAddress;
      caps.push({
        id: `collateral-${address.toLowerCase()}`,
        kind: 'collateral',
        label: collateralSymbols.get(address.toLowerCase()) ?? shortAddress(address),
        lltv: null,
        rateType: null,
        allocationRaw,
        absoluteCapRaw,
        relativeCapWad,
        href: basescanTokenUrl(address),
      });
    } else if (data.adapterAddress) {
      const address = data.adapterAddress;
      caps.push({
        id: `adapter-${address.toLowerCase()}`,
        kind: 'adapter',
        label: adapterLabels.get(address.toLowerCase()) ?? shortAddress(address),
        lltv: null,
        rateType: null,
        allocationRaw,
        absoluteCapRaw,
        relativeCapWad,
        href: null,
      });
    }
  });

  caps.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareRaw(a.allocationRaw, b.allocationRaw)
  );

  return {
    caps,
    assetSymbol: vault.asset?.symbol ?? '',
    assetDecimals: vault.asset?.decimals ?? 18,
  };
}

export async function fetchVaultV2Caps(
  vaultAddress: string,
  chainId: number
): Promise<{ data: VaultCapData | null; error?: string; rateLimited?: boolean }> {
  try {
    const response = await fetchMorphoGraphQL(
      { query: VAULT_CAPS_QUERY, variables: { address: vaultAddress, chainId } },
      {
        revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS,
        tags: [`vault-caps-${vaultAddress}-${chainId}`],
      }
    );
    const { responseText, rateLimited } = await readMorphoGraphQLResponse(response);
    if (!response.ok) {
      return rateLimited
        ? { data: null, error: 'Morpho API rate limit exceeded', rateLimited: true }
        : { data: null, error: `Morpho API error: ${response.status}` };
    }
    const json = JSON.parse(responseText) as {
      errors?: unknown[];
      data?: { vaultV2ByAddress?: VaultCapsGraphQL | null };
    };
    if (json.errors?.length) {
      logger.warn('Vault caps GraphQL errors', { vaultAddress, chainId, errors: json.errors });
      return { data: null, error: 'Failed to load caps' };
    }
    const vault = json.data?.vaultV2ByAddress;
    if (!vault) return { data: null, error: 'Vault not found' };
    return { data: mapVaultV2Caps(vault, chainId) };
  } catch (error) {
    logger.error(
      'Vault caps fetch failed',
      error instanceof Error ? error : new Error(String(error)),
      { vaultAddress, chainId }
    );
    return { data: null, error: 'Failed to load caps' };
  }
}
