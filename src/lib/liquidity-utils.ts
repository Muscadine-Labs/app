import {
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { builderWriteOpts } from './builder-code';
import { getMorphoChainSlug } from './constants';
import { ERC4626_ABI } from './abis';
import type { VaultLiquidityBreakdown } from '@/types/vault';

/** Lowercase slug for Morpho vault URLs (e.g. Muscadine USDC Frontier → muscadine-usdc-frontier). */
export function morphoVaultUrlSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function getMorphoVaultUrl(chainId: number, vaultAddress: string, name?: string): string {
  const network = getMorphoChainSlug(chainId);
  const base = `https://app.morpho.org/${network}/vault/${vaultAddress}`;
  const slug = name ? morphoVaultUrlSlug(name) : '';
  return slug ? `${base}/${slug}` : base;
}

export function parseTransactionAmount(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed) return BigInt(0);
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return BigInt(0);
  }
}

/** Display liquidity on explorer / vault detail (idle + adapter + force-deallocatable). */
export function resolveTotalUnderlyingLiquidityAssets(
  breakdown?: VaultLiquidityBreakdown | null,
  fallbackInstantAssets?: string | null
): string {
  if (breakdown?.totalUnderlyingLiquidityAssets) {
    return breakdown.totalUnderlyingLiquidityAssets;
  }
  return fallbackInstantAssets ?? '0';
}

export function resolveTotalUnderlyingLiquidityUsd(
  breakdown?: VaultLiquidityBreakdown | null,
  fallbackInstantUsd?: number | null
): number {
  if (breakdown?.totalUnderlyingLiquidityUsd != null) {
    return breakdown.totalUnderlyingLiquidityUsd;
  }
  return fallbackInstantUsd ?? 0;
}

/** Returns true when the withdraw/redeem would likely succeed on-chain. */
export async function simulateVaultWithdraw(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  amountAssets: bigint,
  useRedeem: boolean
): Promise<boolean> {
  if (!walletClient.account) return false;

  const userAddress = walletClient.account.address;

  try {
    if (useRedeem) {
      const shares = await publicClient.readContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      });

      if (shares === BigInt(0)) return false;

      await publicClient.simulateContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'redeem',
        args: [shares, userAddress, userAddress],
        account: userAddress,
        ...builderWriteOpts(),
      });
    } else {
      await publicClient.simulateContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'withdraw',
        args: [amountAssets, userAddress, userAddress],
        account: userAddress,
        ...builderWriteOpts(),
      });
    }

    return true;
  } catch {
    return false;
  }
}
