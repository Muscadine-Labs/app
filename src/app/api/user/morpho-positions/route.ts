import { NextRequest, NextResponse } from 'next/server';
import { BASE_CHAIN_ID, STABLECOIN_SYMBOLS } from '@/lib/constants';
import { MORPHO_RATE_LIMIT_BODY } from '@/lib/api-utils';
import {
  getAssetDecimalsForSymbol,
  morphoAmountToDecimal,
  morphoAmountToRaw,
  normalizeMorphoShares,
  rawAmountToDecimal,
  resolveMorphoAssetSymbol,
} from '@/lib/asset-decimals';
import { isValidEthereumAddress, findVaultByAddress, preferredVaultName } from '@/lib/vault-utils';
import { logger } from '@/lib/logger';
import { isMorphoRestRateLimited, MorphoRestError, morphoRestList } from '@/lib/morpho-rest';
import { getRestVault, tryGetRestTokenPriceUsd, toBigInt } from '@/lib/morpho-rest-data';
import { fetchPositionNetEarnings } from '@/lib/morpho-rest-wallet';

/** User positions must be fresh — never cached. */
export const dynamic = 'force-dynamic';

type RestUserPosition = {
  chain_id: number;
  vault_address: string;
  shares: string;
  assets: string;
};

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
      // Morpho has no name for some external vaults; never send an undefined name.
      name: preferredVaultName(vaultName, registryVault?.name, vaultAddress),
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

  try {
    // REST rows carry shares and assets only; name, asset, USD and profit come from other reads.
    const rows = await morphoRestList<RestUserPosition>(
      `/v0/vaults-v2/users/${userAddress}/positions`,
      { chain_ids: chainId, active_only: includeEmpty ? false : true },
      { revalidate: 0, timeoutMs: 20_000 }
    );
    const kept = rows.filter((row) => includeEmpty || toBigInt(row.shares) > BigInt(0));

    const positions = await Promise.all(
      kept.map(async (row) => {
        const registryVault = findVaultByAddress(row.vault_address);
        const vault = await getRestVault(chainId, row.vault_address).catch(() => null);
        const assetDecimalsFromApi = vault?.asset.decimals ?? null;
        const assetSymbol = resolveMorphoAssetSymbol({
          registrySymbol: registryVault?.symbol,
          assetSymbol: vault?.asset.symbol,
          vaultSymbol: vault?.symbol,
          assetDecimals: assetDecimalsFromApi,
          vaultName: vault?.name ?? undefined,
        });
        const decimals = assetDecimalsFromApi ?? getAssetDecimalsForSymbol(assetSymbol);
        const open = toBigInt(row.shares) > BigInt(0);
        const [price, pnl] = await Promise.all([
          vault ? tryGetRestTokenPriceUsd(chainId, vault.asset.address) : Promise.resolve(null),
          // Profit only matters for an open position (an emptied row shows nothing).
          open ? fetchPositionNetEarnings(chainId, row.vault_address, userAddress).catch(() => undefined) : undefined,
        ]);
        const priceUsd =
          price ??
          (STABLECOIN_SYMBOLS.includes(assetSymbol.toUpperCase() as (typeof STABLECOIN_SYMBOLS)[number]) ? 1 : 0);
        const assetsUsd = rawAmountToDecimal(toBigInt(row.assets), decimals) * priceUsd;
        const pnlUsd = pnl !== undefined ? rawAmountToDecimal(toBigInt(pnl), decimals) * priceUsd : undefined;
        return mapPosition(
          row.vault_address,
          vault?.name ?? '',
          assetSymbol,
          decimals,
          row.shares,
          row.assets,
          assetsUsd,
          pnl,
          pnlUsd
        );
      })
    );

    return NextResponse.json({ positions }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (isMorphoRestRateLimited(err)) {
      return NextResponse.json({ ...MORPHO_RATE_LIMIT_BODY, positions: [] }, { status: 503 });
    }
    if (err instanceof MorphoRestError && (err.status === 0 || err.status >= 500)) {
      logger.warn('Morpho positions upstream temporarily unavailable', { userAddress, status: err.status });
      return NextResponse.json(
        { error: 'Morpho API temporarily unavailable', positions: [], retryable: true },
        { status: 503 }
      );
    }
    logger.error('Failed to fetch Morpho user positions', err);
    return NextResponse.json(
      { error: 'Failed to fetch positions', positions: [], retryable: false },
      { status: 502 }
    );
  }
}
