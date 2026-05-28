import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isValidEthereumAddress } from '@/lib/vault-utils';
import { isValidChainId } from '@/lib/api-utils';

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
    
    // V1 vaults use vaultByAddress with nested state
    const query = `
      query VaultComplete($address: String!, $chainId: Int!) {
        vaultByAddress(address: $address, chainId: $chainId) {
          address
          name
          listed
          
          # Asset information
          asset {
            address
            symbol
            decimals
            name
            priceUsd
            yield {
              apr
            }
          }
          
          # Metadata
          metadata {
            description
            forumLink
            image
          }
          
          # Allocators
          allocators {
            address
          }
          
          # State data
          state {
            # Basic metrics
            totalAssets
            totalAssetsUsd
            totalSupply
            owner
            curator
            guardian
            timelock
            fee
            sharePriceUsd
            
            # Yield data
            apy
            netApy
            netApyWithoutRewards
            avgNetApy
            
            # Allocation data
            allocation {
              market {
                uniqueKey: id
                loanAsset {
                  address
                  name
                  symbol
                }
                collateralAsset {
                  address
                  name
                  symbol
                }
                oracleAddress
                irmAddress
                lltv
                state {
                  rewards {
                    asset {
                      address
                      symbol
                    }
                    supplyApr
                    yearlySupplyTokens
                  }
                }
              }
              supplyCap
              supplyAssets
              supplyAssetsUsd
            }
            
            # Rewards
            rewards {
              asset {
                address
                symbol
              }
              supplyApr
              yearlySupplyTokens
            }
          }
        }
      }
    `;

    const response = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      body: JSON.stringify({
        query,
        variables: {
          address,
          chainId,
        },
      }),
      // Use Next.js built-in caching instead of in-memory
      next: { 
        revalidate: 300, // 5 minutes
        tags: [`vault-${address}-${chainId}`]
      },
      // Enable HTTP/2 keep-alive for better performance
      keepalive: true,
    });

    if (!response.ok) {
      throw new Error(`Morpho API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    // Morpho API: `listed` replaced `whitelisted`; `sharePrice` removed from VaultState
    if (data.data?.vaultByAddress) {
      const vault = data.data.vaultByAddress;
      vault.whitelisted = vault.listed ?? false;

      const state = vault.state;
      if (state) {
        const totalAssets = state.totalAssets || '0';
        const totalSupply = state.totalSupply || '0';
        const totalAssetsUsd = state.totalAssetsUsd || 0;
        const assetDecimals = vault.asset?.decimals || 18;

        let sharePrice = 0;
        let sharePriceUsd = state.sharePriceUsd || 0;

        if (totalSupply !== '0' && totalAssets !== '0') {
          const totalAssetsNum = BigInt(totalAssets);
          const totalSupplyNum = BigInt(totalSupply);
          const totalAssetsDecimal = Number(totalAssetsNum) / Math.pow(10, assetDecimals);
          const totalSupplyDecimal = Number(totalSupplyNum) / 1e18;

          if (totalSupplyDecimal > 0) {
            sharePrice = totalAssetsDecimal / totalSupplyDecimal;
            if (!sharePriceUsd && totalAssetsUsd > 0) {
              sharePriceUsd = totalAssetsUsd / totalSupplyDecimal;
            }
          }
        }

        state.sharePrice = sharePrice;
        state.sharePriceUsd = sharePriceUsd;
        state.avgApy = state.avgNetApy ?? state.apy ?? 0;
      }
    }

    return NextResponse.json({
      ...data,
      cached: false,
      timestamp: Date.now(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
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


