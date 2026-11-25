import { isMorphoRestNotFound, isMorphoRestRateLimited } from '@/lib/morpho-rest';
import { adapterTypeName, allRestCaps, getRestToken, getRestVault, getRestVaultAllocations, toBigInt } from '@/lib/morpho-rest-data';
import { loadMarketDetails } from '@/lib/vault-v2-markets';
import { getMorphoMarketUrl, type MorphoMarketRateType } from '@/lib/morpho-market-url';
import { BASE_CHAIN_ID } from '@/lib/constants';
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

type NumericLike = string | number | null | undefined;

/** Cap input shape, built from Morpho REST `/allocations`. */
export interface VaultCapsInput {
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
export function mapVaultV2Caps(
  vault: VaultCapsInput,
  chainId: number = BASE_CHAIN_ID,
  /** Lowercase token address → symbol, for token caps on collateral no listed market uses. */
  tokenSymbols: ReadonlyMap<string, string> = new Map()
): VaultCapData {
  const collateralSymbols = new Map<string, string>(tokenSymbols);
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

const CAP_TYPE_NAME: Record<string, string> = {
  market_v1: 'MarketV1',
  collateral: 'Collateral',
  adapter: 'Adapter',
};

/**
 * Every cap of a vault from Morpho REST `/allocations` (market, token and adapter caps in one
 * read), with market params and token symbols from REST. Throws on a failed read, so the caps
 * section shows an error instead of a list missing rows.
 */
async function loadVaultCaps(vaultAddress: string, chainId: number): Promise<VaultCapData> {
  const [vault, allocations] = await Promise.all([
    getRestVault(chainId, vaultAddress),
    getRestVaultAllocations(chainId, vaultAddress),
  ]);
  const caps = allRestCaps(allocations).filter(
    (cap) => toBigInt(cap.absolute_cap) > BigInt(0) || toBigInt(cap.allocated_assets) > BigInt(0)
  );
  const marketIds = [...new Set(caps.filter((c) => c.cap_type === 'market_v1' && c.market_id).map((c) => c.market_id!.toLowerCase()))];
  const collateralTokens = [...new Set(caps.filter((c) => c.cap_type === 'collateral' && c.collateral_address).map((c) => c.collateral_address!.toLowerCase()))];
  const [markets, tokens] = await Promise.all([
    loadMarketDetails(chainId, marketIds),
    Promise.all(collateralTokens.map((t) => getRestToken(chainId, t).catch(() => null))),
  ]);
  const marketById = new Map(markets.map((m) => [m.marketId, m]));
  const tokenSymbols = new Map<string, string>();
  tokens.forEach((token, i) => {
    if (token?.symbol) tokenSymbols.set(collateralTokens[i]!, token.symbol);
  });

  const seen = new Set<string>();
  const items: NonNullable<NonNullable<VaultCapsInput['caps']>['items']> = [];
  for (const cap of caps) {
    const key = `${cap.cap_type}:${(cap.cap_id ?? cap.market_id ?? cap.collateral_address ?? cap.adapter_address ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = {
      type: CAP_TYPE_NAME[cap.cap_type ?? ''] ?? cap.cap_type ?? null,
      absoluteCap: cap.absolute_cap ?? '0',
      relativeCap: cap.relative_cap_wad ?? '0',
      allocation: cap.allocated_assets ?? '0',
    };
    if (cap.cap_type === 'market_v1' && cap.market_id) {
      const m = marketById.get(cap.market_id.toLowerCase());
      items.push({
        ...base,
        data: {
          market: {
            marketId: cap.market_id,
            lltv: m?.market.lltv_wad ?? null,
            loanAsset: { symbol: m?.loanToken.symbol ?? null },
            collateralAsset: { address: m?.market.collateral_token ?? null, symbol: m?.collateralToken?.symbol ?? null },
          },
        },
      });
    } else if (cap.cap_type === 'collateral' && cap.collateral_address) {
      items.push({ ...base, data: { collateralAddress: cap.collateral_address } });
    } else if (cap.cap_type === 'adapter' && cap.adapter_address) {
      items.push({ ...base, data: { adapterAddress: cap.adapter_address } });
    }
  }

  return mapVaultV2Caps(
    {
      asset: { symbol: vault.asset.symbol, decimals: vault.asset.decimals },
      adapters: {
        items: (allocations.allocations ?? []).map((a) => ({
          __typename: adapterTypeName(a?.adapter_kind),
          address: a?.adapter_address ?? null,
        })),
      },
      caps: { items },
    },
    chainId,
    tokenSymbols
  );
}

export async function fetchVaultV2Caps(
  vaultAddress: string,
  chainId: number
): Promise<{ data: VaultCapData | null; error?: string; rateLimited?: boolean }> {
  try {
    return { data: await loadVaultCaps(vaultAddress, chainId) };
  } catch (error) {
    if (isMorphoRestNotFound(error)) return { data: null, error: 'Vault not found' };
    if (isMorphoRestRateLimited(error)) {
      return { data: null, error: 'Morpho API rate limit exceeded', rateLimited: true };
    }
    logger.error(
      'Vault caps fetch failed',
      error instanceof Error ? error : new Error(String(error)),
      { vaultAddress, chainId }
    );
    return { data: null, error: 'Failed to load caps' };
  }
}
