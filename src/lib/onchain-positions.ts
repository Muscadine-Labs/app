import { getAddress, type Address, type PublicClient } from 'viem';
import { ERC20_BALANCE_ABI, ERC4626_ABI } from '@/lib/abis';
import { getRegistryVaultList } from '@/lib/vaults';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';

/**
 * Below this many base units a position is dust: a force-redeem exit fixes its share count when
 * the tx is built, and interest accrued before it is mined leaves a few shares behind (worth
 * ~1e-14 WETH). Treated as no position so a closed vault is not listed as held. 1e-9 of a token
 * for 18-decimal assets, otherwise nothing below one base unit (USDC 1e-6, cbBTC 1 sat).
 */
export function vaultDustThreshold(assetDecimals: number): bigint {
  return assetDecimals > 9 ? BigInt(10) ** BigInt(assetDecimals - 9) : BigInt(1);
}

/** This wallet's share balance and its value in the vault asset, read on chain. */
export interface OnChainVaultBalance {
  shares: bigint;
  assets: bigint;
}

/**
 * Share balances and asset values for every registry vault, read on chain in two multicalls.
 * Keys are lowercase vault addresses. Returns null when the reads fail, so callers keep the
 * Morpho API values instead of showing zeros.
 */
export async function readRegistryVaultBalances(
  publicClient: PublicClient,
  wallet: Address
): Promise<Record<string, OnChainVaultBalance> | null> {
  const vaults = getRegistryVaultList();
  try {
    const shares = (await publicClient.multicall({
      allowFailure: false,
      contracts: vaults.map((vault) => ({
        address: getAddress(vault.address),
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf' as const,
        args: [wallet] as const,
      })),
    })) as bigint[];

    const held = vaults
      .map((vault, i) => ({ vault, shares: shares[i] }))
      .filter((item) => item.shares > BigInt(0));
    const assets = held.length
      ? ((await publicClient.multicall({
          allowFailure: false,
          contracts: held.map((item) => ({
            address: getAddress(item.vault.address),
            abi: ERC4626_ABI,
            functionName: 'convertToAssets' as const,
            args: [item.shares] as const,
          })),
        })) as bigint[])
      : [];

    const balances: Record<string, OnChainVaultBalance> = {};
    for (const vault of vaults) {
      balances[vault.address.toLowerCase()] = { shares: BigInt(0), assets: BigInt(0) };
    }
    held.forEach((item, i) => {
      if (assets[i] < vaultDustThreshold(getAssetDecimalsForSymbol(item.vault.symbol))) return;
      balances[item.vault.address.toLowerCase()] = { shares: item.shares, assets: assets[i] };
    });
    return balances;
  } catch {
    return null;
  }
}
