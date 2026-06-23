import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId } from '@/lib/api-utils';
import { fetchVaultV2ActivityData } from '@/lib/vault-v2-activity';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  const chainIdParam = searchParams.get('chainId') || '8453';
  const userAddress = searchParams.get('userAddress');

  let address: string | undefined;
  try {
    const resolvedParams = await params;
    address = resolvedParams.address;

    if (!isValidEthereumAddress(address)) {
      return NextResponse.json(
        {
          transactions: [],
          deposits: [],
          withdrawals: [],
          events: [],
          error: 'Invalid vault address format',
        },
        { status: 400 }
      );
    }

    if (!isValidChainId(chainIdParam)) {
      return NextResponse.json(
        {
          transactions: [],
          deposits: [],
          withdrawals: [],
          events: [],
          error: 'Invalid chain ID',
        },
        { status: 400 }
      );
    }

    if (userAddress && !isValidEthereumAddress(userAddress)) {
      return NextResponse.json(
        {
          transactions: [],
          deposits: [],
          withdrawals: [],
          events: [],
          error: 'Invalid user address format',
        },
        { status: 400 }
      );
    }

    const chainId = parseInt(chainIdParam, 10);
    const activity = await fetchVaultV2ActivityData(
      address,
      chainId,
      userAddress ?? undefined
    );

    if (activity.error) {
      return NextResponse.json(
        {
          transactions: activity.transactions,
          deposits: activity.deposits,
          withdrawals: activity.withdrawals,
          events: activity.events,
          error: activity.error,
          cached: false,
          timestamp: Date.now(),
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        transactions: activity.transactions,
        deposits: activity.deposits,
        withdrawals: activity.withdrawals,
        events: activity.events,
        assetPriceUsd: activity.assetPriceUsd,
        assetDecimals: activity.assetDecimals,
        cached: false,
        timestamp: Date.now(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (error) {
    logger.error(
      'Vault activity API error',
      error instanceof Error ? error : new Error(String(error)),
      { address: address ?? 'unknown', chainId: chainIdParam }
    );

    return NextResponse.json(
      {
        transactions: [],
        deposits: [],
        withdrawals: [],
        events: [],
        error: 'Failed to fetch vault activity data',
      },
      { status: 500 }
    );
  }
}
