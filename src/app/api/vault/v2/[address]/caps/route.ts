import { NextRequest, NextResponse } from 'next/server';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId, MORPHO_RATE_LIMIT_BODY } from '@/lib/api-utils';
import { BASE_CHAIN_ID, MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { fetchVaultV2Caps } from '@/lib/vault-v2-caps';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || String(BASE_CHAIN_ID);
  const { address } = await params;

  if (!isValidEthereumAddress(address)) {
    return NextResponse.json({ error: 'Invalid vault address format' }, { status: 400 });
  }
  if (!isValidChainId(chainIdParam)) {
    return NextResponse.json({ error: 'Invalid chain ID' }, { status: 400 });
  }

  const { data, error, rateLimited } = await fetchVaultV2Caps(address, parseInt(chainIdParam, 10));

  if (rateLimited) {
    return NextResponse.json(MORPHO_RATE_LIMIT_BODY, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!data) {
    return NextResponse.json(
      { error: error ?? 'Failed to load caps' },
      { status: error === 'Vault not found' ? 404 : 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `public, s-maxage=${MORPHO_GRAPHQL_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_GRAPHQL_REVALIDATE_SECONDS * 2}`,
    },
  });
}
