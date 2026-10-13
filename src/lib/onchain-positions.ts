import { getAddress, type Address, type PublicClient } from 'viem';
import { ERC20_BALANCE_ABI, ERC4626_ABI } from '@/lib/abis';
import { getRegistryVaultList } from '@/lib/vaults';

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
      balances[item.vault.address.toLowerCase()] = { shares: item.shares, assets: assets[i] };
    });
    return balances;
  } catch {
    return null;
  }
}
