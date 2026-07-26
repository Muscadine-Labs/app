import { NextRequest, NextResponse } from 'next/server';
import { BASE_CHAIN_ID } from '@/lib/constants';

/** User positions must be fresh — never use the Morpho GraphQL response cache. */
export const dynamic = 'force-dynamic';
import { fetchMorphoGraphQL } from '@/lib/api-utils';
import {
  getAssetDecimalsForSymbol,
  morphoAmountToDecimal,
  morphoAmountToRaw,
  normalizeMorphoShares,
  resolveMorphoAssetSymbol,
} from '@/lib/asset-decimals';
import { isValidEthereumAddress, findVaultByAddress } from '@/lib/vault-utils';
import { logger } from '@/lib/logger';

interface MorphoV2PositionItem {
  assets: number | string;
  assetsUsd: number;
  shares: number | string;
  pnl?: number | string;
  pnlUsd?: number;
  vault: {
    address: string;
    name: string;
    symbol?: string;
    asset?: { symbol?: string; decimals?: number };
  };
}

interface UserPositionsGraphQL {
  userByAddress?: {
    vaultV2Positions: MorphoV2PositionItem[];
  };
}

function mapPosition(
  vaultAddress: string,
  vaultName: string,
  assetSymbol: string,
  assetDecimals: number,
  shares: number | string,
  assets: number | string,
  assetsUsd: number,
  pnl: number | string | undefined,
  pnlUsd: number | undefined
) {
  const registryVault = findVaultByAddress(vaultAddress);
  const decimals = assetDecimals || getAssetDecimalsForSymbol(assetSymbol);

  return {
    vault: {
      address: vaultAddress,
      name: registryVault?.name ?? vaultName,
      symbol: assetSymbol,
      vaultSymbol: registryVault?.vaultSymbol,
      strategy: registryVault?.strategy,
      isCurated: !!registryVault,
    },
    version: 'v2' as const,
    assetDecimals: decimals,
    shares: normalizeMorphoShares(shares),
    assets: morphoAmountToRaw(assets),
    assetsUsd,
    pnl: pnl !== undefined && pnl !== null ? morphoAmountToDecimal(pnl, decimals) : undefined,
    pnlUsd,
    pnlRaw: pnl !== undefined && pnl !== null ? morphoAmountToRaw(pnl) : undefined,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userAddress = searchParams.get('address');
  const chainIdParam = searchParams.get('chainId') || String(BASE_CHAIN_ID);

  if (!userAddress || !isValidEthereumAddress(userAddress)) {
    return NextResponse.json({ error: 'Invalid user address' }, { status: 400 });
  }

  const chainId = Number(chainIdParam);
  if (!Number.isInteger(chainId) || chainId !== BASE_CHAIN_ID) {
    return NextResponse.json({ error: 'Unsupported chainId' }, { status: 400 });
  }
  const includeEmpty = searchParams.get('includeEmpty') === 'true';

  const query = `
    query UserMorphoPositions($address: String!, $chainId: Int!) {
      userByAddress(address: $address, chainId: $chainId) {
        vaultV2Positions {
          assets
          assetsUsd
          shares
          pnl
          pnlUsd
          vault {
            address
            name
            symbol
            asset {
              symbol
              decimals
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetchMorphoGraphQL(
      {
        query,
        variables: { address: userAddress, chainId },
      },
      { timeoutMs: 20_000, revalidate: 0, skipMemoryCache: true }
    );

    if (!response.ok) {
      throw new Error(`Morpho API returned ${response.status}`);
    }

    const json = (await response.json()) as {
      data?: UserPositionsGraphQL;
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }

    const v2Raw = json.data?.userByAddress?.vaultV2Positions ?? [];

    const positions = v2Raw
      .filter((p) => {
        if (includeEmpty) return true;
        const sharesRaw = normalizeMorphoShares(p.shares);
        try {
          return BigInt(sharesRaw) > BigInt(0);
        } catch {
          return false;
        }
      })
      .map((p) => {
        const registryVault = findVaultByAddress(p.vault.address);
        const assetDecimalsFromApi = p.vault.asset?.decimals ?? null;
        const assetSymbol = resolveMorphoAssetSymbol({
          registrySymbol: registryVault?.symbol,
          assetSymbol: p.vault.asset?.symbol,
          vaultSymbol: p.vault.symbol,
          assetDecimals: assetDecimalsFromApi,
          vaultName: p.vault.name,
        });
        const resolvedDecimals =
          assetDecimalsFromApi ?? getAssetDecimalsForSymbol(assetSymbol);
        return mapPosition(
          p.vault.address,
          p.vault.name,
          assetSymbol,
          resolvedDecimals,
          p.shares,
          p.assets,
          p.assetsUsd,
          p.pnl,
          p.pnlUsd
        );
      });

    return NextResponse.json({ positions });
  } catch (err) {
    logger.error('Failed to fetch Morpho user positions', err);
    return NextResponse.json(
      { error: 'Failed to fetch positions', positions: [] },
      { status: 500 }
    );
  }
}
