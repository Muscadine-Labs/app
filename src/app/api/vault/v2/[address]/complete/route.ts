import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId, fetchMorphoGraphQL, readMorphoGraphQLResponse, MORPHO_RATE_LIMIT_BODY } from '@/lib/api-utils';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';

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

    // Validate inputs
    if (!isValidEthereumAddress(address)) {
      return NextResponse.json(
        { error: 'Invalid vault address format' },
        { status: 400 }
      );
    }

    if (!isValidChainId(chainIdParam)) {
      return NextResponse.json(
        { error: 'Invalid chain ID' },
        { status: 400 }
      );
    }

    const chainId = parseInt(chainIdParam, 10);
    
    // V2 vaults use vaultV2ByAddress per Morpho API docs
    // https://docs.morpho.org/tools/offchain/api/morpho-vaults/
    const query = `
      query VaultComplete($address: String!, $chainId: Int!) {
        vaultV2ByAddress(address: $address, chainId: $chainId) {
          address
          name
          listed
          
          # Asset information
          asset {
            address
            symbol
            decimals
            name
            price {
              usd
            }
            yield {
              apr
            }
          }
          
          # Metadata
          metadata {
            description
            image
          }
          
          # Total Deposits & Assets
          totalAssets
          totalAssetsUsd
          totalSupply
          liquidity
          liquidityUsd
          idleAssets
          idleAssetsUsd
          forceDeallocatableLiquidity
          forceDeallocatableLiquidityUsd
          liquidityAdapter {
            address
          }
          
          # APY — apy/netApy are current allocation-weighted rates (Morpho deposit widget)
          apy
          netApy
          avgNetApy
          avgNetApyExcludingRewards
          maxApy
          performanceFee
          managementFee
          maxRate
          
          # Rewards
          rewards {
            asset {
              address
              chain {
                id
              }
            }
            supplyApr
          }
          
          # Configuration & Curation
          allocators {
            allocator {
              address
            }
          }
          owner {
            address
          }
          curators {
            items {
              addresses {
                address
              }
            }
          }
          sentinels {
            sentinel {
              address
            }
          }
          timelocks {
            duration
            selector
            functionName
          }
          
          # Risk Indicators
          warnings {
            type
            level
          }
        }
      }
    `;

    const response = await fetchMorphoGraphQL(
      {
        query,
        variables: {
          address,
          chainId,
        },
      },
      {
        revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS,
        tags: [`vault-${address}-${chainId}`],
      }
    );

    const { responseText, rateLimited } = await readMorphoGraphQLResponse(response);

    if (!response.ok) {
      if (rateLimited) {
        return NextResponse.json(MORPHO_RATE_LIMIT_BODY, { status: 503 });
      }
      throw new Error(`Morpho API error: ${response.status}`);
    }

    const data = JSON.parse(responseText);

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    // For v2 vaults, normalize response structure to match v1 format for compatibility
    if (data.data?.vaultV2ByAddress) {
      const vault = data.data.vaultV2ByAddress;
      const totalAssets = vault.totalAssets || '0';
      const totalSupply = vault.totalSupply || '0';
      const totalAssetsUsd = vault.totalAssetsUsd || 0;

      // Calculate sharePrice in tokens: totalAssets / totalSupply
      // Both are in raw units, so we need to account for decimals
      let sharePrice = 0;
      let sharePriceUsd = 0;
      
      if (totalSupply && totalSupply !== '0' && totalAssets && totalAssets !== '0') {
        const assetDecimals = vault.asset?.decimals || 18;
        const totalAssetsNum = BigInt(totalAssets);
        const totalSupplyNum = BigInt(totalSupply);
        
        // Convert to decimal for calculation
        const totalAssetsDecimal = Number(totalAssetsNum) / Math.pow(10, assetDecimals);
        const totalSupplyDecimal = Number(totalSupplyNum) / 1e18; // Shares are always 18 decimals
        
        if (totalSupplyDecimal > 0) {
          sharePrice = totalAssetsDecimal / totalSupplyDecimal;
          sharePriceUsd = totalAssetsUsd > 0 && totalSupplyDecimal > 0 
            ? totalAssetsUsd / totalSupplyDecimal 
            : 0;
        }
      }
      
      // Normalize allocators structure from V2 format to V1 format for compatibility
      const normalizedAllocators = vault.allocators?.map((alloc: { allocator: { address: string } }) => ({
        address: alloc.allocator?.address || '',
      })) || [];
      
      // Headline: Morpho netApy; popover uses gross apy → fees → netApy.
      const morphoGrossApy = vault.apy ?? vault.netApy ?? 0;
      const morphoNetApy =
        vault.netApy ?? vault.apy ?? vault.avgNetApy ?? vault.avgNetApyExcludingRewards ?? 0;
      const morphoAvgNetApy =
        vault.avgNetApy ?? vault.avgNetApyExcludingRewards ?? morphoNetApy;
      const morphoBaseApy =
        vault.avgNetApyExcludingRewards ?? vault.avgNetApy ?? morphoAvgNetApy;

      const instantLiquidityRaw = (() => {
        try {
          return BigInt(vault.liquidity ?? 0);
        } catch {
          return BigInt(0);
        }
      })();
      const idleLiquidityRaw = (() => {
        try {
          return BigInt(vault.idleAssets ?? 0);
        } catch {
          return BigInt(0);
        }
      })();
      const deallocatableLiquidityRaw = (() => {
        try {
          return BigInt(vault.forceDeallocatableLiquidity ?? 0);
        } catch {
          return BigInt(0);
        }
      })();
      const liquidityAdapterRaw =
        instantLiquidityRaw > idleLiquidityRaw
          ? instantLiquidityRaw - idleLiquidityRaw
          : BigInt(0);
      const totalUnderlyingLiquidityRaw = instantLiquidityRaw + deallocatableLiquidityRaw;
      const instantLiquidityUsd = Number(vault.liquidityUsd ?? 0);
      const idleLiquidityUsd = Number(vault.idleAssetsUsd ?? 0);
      const deallocatableLiquidityUsd = Number(vault.forceDeallocatableLiquidityUsd ?? 0);
      const liquidityAdapterUsd = Math.max(0, instantLiquidityUsd - idleLiquidityUsd);
      const totalUnderlyingLiquidityUsd = instantLiquidityUsd + deallocatableLiquidityUsd;

      data.data.vaultByAddress = {
        ...vault,
        liquidity: instantLiquidityRaw.toString(),
        liquidityUsd: instantLiquidityUsd,
        liquidityBreakdown: {
          instantLiquidityAssets: instantLiquidityRaw.toString(),
          instantLiquidityUsd,
          idleLiquidityAssets: idleLiquidityRaw.toString(),
          idleLiquidityUsd,
          liquidityAdapterAssets: liquidityAdapterRaw.toString(),
          liquidityAdapterUsd,
          deallocatableLiquidityAssets: deallocatableLiquidityRaw.toString(),
          deallocatableLiquidityUsd,
          totalUnderlyingLiquidityAssets: totalUnderlyingLiquidityRaw.toString(),
          totalUnderlyingLiquidityUsd,
        },
        whitelisted: vault.listed ?? false,
        allocators: normalizedAllocators,
        state: {
          totalAssets: vault.totalAssets,
          totalAssetsUsd: vault.totalAssetsUsd,
          totalSupply: vault.totalSupply,
          sharePrice: sharePrice,
          sharePriceUsd: sharePriceUsd,
          apy: morphoNetApy,
          grossApy: morphoGrossApy,
          netApy: morphoNetApy,
          netApyWithoutRewards: morphoBaseApy,
          avgApy: morphoBaseApy,
          avgNetApy: morphoAvgNetApy,
          maxApy: vault.maxApy || 0,
          owner: vault.owner || '',
          curator: vault.curator || '',
          guardian: vault.guardian || '',
          timelock: vault.timelock || 0,
          fee: vault.fee || 0,
          allocation: vault.allocation || [],
          rewards: vault.rewards || [],
        },
      };
      delete data.data.vaultV2ByAddress;
    }

    return NextResponse.json({
      ...data,
      cached: false,
      timestamp: Date.now(),
    }, {
      headers: {
        'Cache-Control': `public, s-maxage=${MORPHO_GRAPHQL_REVALIDATE_SECONDS}, stale-while-revalidate=${MORPHO_GRAPHQL_REVALIDATE_SECONDS * 2}`,
      }
    });

  } catch (error) {
    logger.error(
      'Failed to fetch complete vault data',
      error instanceof Error ? error : new Error(String(error)),
      { address: address ?? 'unknown', chainId: chainIdParam }
    );

    return NextResponse.json(
      { 
        error: 'Failed to fetch complete vault data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}


