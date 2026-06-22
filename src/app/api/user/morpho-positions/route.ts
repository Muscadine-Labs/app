import { NextRequest, NextResponse } from 'next/server';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { fetchMorphoGraphQL } from '@/lib/api-utils';
import {
  getAssetDecimalsForSymbol,
  morphoAmountToDecimal,
  morphoAmountToRaw,
  normalizeMorphoShares,
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

interface MorphoV1PositionItem {
  vault: {
    address: string;
    name: string;
    symbol?: string;
    asset?: { symbol?: string; decimals?: number };
  };
  state?: {
    assets?: number;
    assetsUsd?: number;
    shares?: number;
    pnl?: number;
    pnlUsd?: number;
  };
}

interface UserPositionsGraphQL {
  userByAddress?: {
    vaultV2Positions: MorphoV2PositionItem[];
    vaultPositions: MorphoV1PositionItem[];
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
  pnlUsd: number | undefined,
  version: 'v1' | 'v2'
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
    version,
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
        vaultPositions {
          vault {
            address
            name
            symbol
            asset {
              symbol
              decimals
            }
          }
          state {
            assets
            assetsUsd
            shares
            pnl
            pnlUsd
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
      { timeoutMs: 20_000 }
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
    const v1Raw = json.data?.userByAddress?.vaultPositions ?? [];

    const v2Positions = v2Raw
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
        const assetSymbol =
          findVaultByAddress(p.vault.address)?.symbol ??
          p.vault.asset?.symbol ??
          p.vault.symbol ??
          'UNKNOWN';
        const assetDecimals =
          p.vault.asset?.decimals ?? getAssetDecimalsForSymbol(assetSymbol);
        return mapPosition(
          p.vault.address,
          p.vault.name,
          assetSymbol,
          assetDecimals,
          p.shares,
          p.assets,
          p.assetsUsd,
          p.pnl,
          p.pnlUsd,
          'v2'
        );
      });

    const v1Positions = v1Raw
      .filter((p) => {
        if (includeEmpty) return true;
        return (p.state?.shares ?? 0) > 0;
      })
      .map((p) => {
        const assetSymbol =
          findVaultByAddress(p.vault.address)?.symbol ??
          p.vault.asset?.symbol ??
          p.vault.symbol ??
          'UNKNOWN';
        const assetDecimals =
          p.vault.asset?.decimals ?? getAssetDecimalsForSymbol(assetSymbol);
        const state = p.state ?? {
          shares: 0,
          assets: 0,
          assetsUsd: 0,
          pnl: 0,
          pnlUsd: 0,
        };
        return mapPosition(
          p.vault.address,
          p.vault.name,
          assetSymbol,
          assetDecimals,
          state.shares ?? 0,
          state.assets ?? 0,
          state.assetsUsd ?? 0,
          state.pnl,
          state.pnlUsd,
          'v1'
        );
      });

    // Deduplicate: if same address appears in both (shouldn't), prefer v2
    const seen = new Set<string>();
    const positions = [...v2Positions, ...v1Positions].filter((p) => {
      const key = p.vault.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
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
