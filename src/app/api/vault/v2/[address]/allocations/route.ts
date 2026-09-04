import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId, MORPHO_RATE_LIMIT_BODY } from '@/lib/api-utils';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { fetchVaultV2AllocationData } from '@/lib/vault-v2-allocations';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || '8453';

  let address: string | undefined;
  try {
    const resolvedParams = await params;
    address = resolvedParams.address;

    if (!isValidEthereumAddress(address)) {
      return NextResponse.json({ error: 'Invalid vault address format', allocations: [] }, { status: 400 });
    }

    if (!isValidChainId(chainIdParam)) {
      return NextResponse.json({ error: 'Invalid chain ID', allocations: [] }, { status: 400 });
    }

    const chainId = parseInt(chainIdParam, 10);
    const { allocations, error, rateLimited } =
      await fetchVaultV2AllocationData(address, chainId);

    if (rateLimited) {
      return NextResponse.json(
        { ...MORPHO_RATE_LIMIT_BODY, allocations: [] },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const cacheHeaders = error
      ? { 'Cache-Control': 'no-store' }
      : {
          'Cache-Control': `public, s-maxage=${MORPHO_GRAPHQL_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_GRAPHQL_REVALIDATE_SECONDS * 2}`,
        };

    return NextResponse.json(
      {
        allocations,
        error: error ?? null,
        cached: false,
        timestamp: Date.now(),
      },
      { headers: cacheHeaders }
    );
  } catch (error) {
    logger.error(
      'Failed to fetch vault allocations',
      error instanceof Error ? error : new Error(String(error)),
      { address: address ?? 'unknown', chainId: chainIdParam }
    );

    return NextResponse.json(
      {
        error: 'Failed to fetch vault allocations',
        details: error instanceof Error ? error.message : 'Unknown error',
        allocations: [],
      },
      { status: 500 }
    );
  }
}
