import { NextRequest, NextResponse } from 'next/server';
import { BASE_CHAIN_ID, MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { fetchMorphoGraphQL } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { mapMorphoAssetPrices, parsePriceAddresses, type MorphoPricedAsset } from '@/lib/token-prices';

const ASSET_PRICES_QUERY = `
  query AssetPrices($addresses: [String!]!, $chainId: Int!) {
    assets(where: { address_in: $addresses, chainId_in: [$chainId] }, first: 100) {
      items { address logoURI price { usd } }
    }
  }
`;

/**
 * USD prices for Base tokens by address, from Morpho's API (the same source as vault and
 * position USD values). Works for any token Morpho indexes, which includes every vault asset.
 */
export async function GET(request: NextRequest) {
  const addresses = parsePriceAddresses(request.nextUrl.searchParams.get('addresses'));
  if (addresses.length === 0) {
    return NextResponse.json({ error: 'addresses must list one or more token addresses' }, { status: 400 });
  }

  try {
    const response = await fetchMorphoGraphQL(
      {
        query: ASSET_PRICES_QUERY,
        variables: { addresses: [...addresses].sort(), chainId: BASE_CHAIN_ID },
      },
      { revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS }
    );
    const body = (await response.json().catch(() => null)) as {
      data?: { assets?: { items?: MorphoPricedAsset[] } };
      errors?: unknown[];
    } | null;
    const items = body?.data?.assets?.items;
    if (!response.ok || !Array.isArray(items)) {
      logger.warn('Morpho asset prices unavailable', { status: response.status });
      return NextResponse.json(
        { error: 'Prices unavailable', prices: {}, logos: {} },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(mapMorphoAssetPrices(items), {
      headers: {
        'Cache-Control': `public, s-maxage=${MORPHO_GRAPHQL_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_GRAPHQL_REVALIDATE_SECONDS * 5}`,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch prices', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      { error: 'Prices unavailable', prices: {}, logos: {} },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
