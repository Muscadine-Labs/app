import { NextRequest, NextResponse } from 'next/server';
import { BASE_CHAIN_ID, MORPHO_REST_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { getRestToken, getRestTokenPriceUsd } from '@/lib/morpho-rest-data';
import { isMorphoRestNotFound } from '@/lib/morpho-rest';
import { mapMorphoAssetPrices, parsePriceAddresses, type MorphoPricedAsset } from '@/lib/token-prices';

/**
 * USD prices for Base tokens by address, from Morpho REST (`/v0/tokens/{t}/price`, spot,
 * one call per token, cached 60s; logos from `/v0/tokens/{t}`, cached 1h). Works for any token
 * Morpho indexes, which includes every vault asset.
 */
export async function GET(request: NextRequest) {
  const addresses = parsePriceAddresses(request.nextUrl.searchParams.get('addresses'));
  if (addresses.length === 0) {
    return NextResponse.json({ error: 'addresses must list one or more token addresses' }, { status: 400 });
  }

  const results = await Promise.allSettled(
    addresses.map(async (address): Promise<MorphoPricedAsset> => {
      const [price, token] = await Promise.all([
        getRestTokenPriceUsd(BASE_CHAIN_ID, address),
        getRestToken(BASE_CHAIN_ID, address).catch(() => null),
      ]);
      return { address, logoURI: token?.logo_uri ?? null, price: { usd: price } };
    })
  );
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  // A token Morpho does not index (404) just has no price; any other failure is an outage.
  const failed = results.filter((r) => r.status === 'rejected' && !isMorphoRestNotFound(r.reason));
  if (failed.length > 0 && items.length === 0) {
    logger.warn('Morpho token prices unavailable', { failed: failed.length });
    return NextResponse.json(
      { error: 'Prices unavailable', prices: {}, logos: {} },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(mapMorphoAssetPrices(items), {
    headers: {
      // A partial result is served but not cached at the edge.
      'Cache-Control':
        failed.length > 0
          ? 'no-store'
          : `public, s-maxage=${MORPHO_REST_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_REST_REVALIDATE_SECONDS * 5}`,
    },
  });
}
