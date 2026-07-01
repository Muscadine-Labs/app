import {
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { builderWriteOpts } from './builder-code';
import { BASE_CHAIN_ID } from './constants';
import { ERC4626_ABI } from './abis';
import type { VaultLiquidityBreakdown } from '@/types/vault';

const CHAIN_SLUG: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
};

/** 0.5% slack on instant liquidity comparisons (staleness + rounding). */
const INSTANT_LIQUIDITY_TOLERANCE_BPS = BigInt(50);

export function getMorphoVaultUrl(chainId: number, vaultAddress: string): string {
  const network = CHAIN_SLUG[chainId] ?? 'base';
  return `https://app.morpho.org/${network}/vault/${vaultAddress}`;
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

export function instantLiquidityTolerance(
  instantLiquidity: bigint,
  assetDecimals: number
): bigint {
  const bpsTolerance = (instantLiquidity * INSTANT_LIQUIDITY_TOLERANCE_BPS) / BigInt(10000);
  const minTolerance = BigInt(10) ** BigInt(Math.max(0, assetDecimals - 2));
  return bpsTolerance > minTolerance ? bpsTolerance : minTolerance;
}

/** True when requested withdraw exceeds idle + liquidity adapter depth (with tolerance). */
export function exceedsInstantLiquidity(
  requestedAssets: bigint,
  instantLiquidityAssets: bigint,
  assetDecimals: number
): boolean {
  if (requestedAssets <= BigInt(0)) return false;
  if (instantLiquidityAssets <= BigInt(0)) return true;
  const tolerance = instantLiquidityTolerance(instantLiquidityAssets, assetDecimals);
  return requestedAssets > instantLiquidityAssets + tolerance;
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

export async function fetchInstantLiquidityAssets(
  vaultAddress: string,
  chainId: number = BASE_CHAIN_ID
): Promise<bigint | null> {
  try {
    const response = await fetch(
      `/api/vault/v2/${vaultAddress}/complete?chainId=${chainId}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return null;

    const data = await response.json();
    const breakdown = data.data?.vaultByAddress?.liquidityBreakdown as
      | VaultLiquidityBreakdown
      | undefined;

    if (breakdown?.instantLiquidityAssets) {
      return BigInt(breakdown.instantLiquidityAssets);
    }

    const liquidity = data.data?.vaultByAddress?.liquidity;
    if (liquidity != null) {
      return BigInt(liquidity);
    }

    return null;
  } catch {
    return null;
  }
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
