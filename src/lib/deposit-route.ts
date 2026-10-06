import type { Address } from 'viem';
import {
  GENERAL_ADAPTER_ADDRESS,
  VAULT_BUNDLES_V1_ADDRESS,
} from './constants';

export type DepositExecutionRoute = 'erc4626' | 'bundler3' | 'vault-bundles-v1';

/**
 * VaultBundlesV1 supports one funding source per deposit. Keep the existing
 * Bundler3 route for the explicit ETH + WETH option so it remains atomic.
 */
export function resolveDepositExecutionRoute(options: {
  isWethVault: boolean;
  preferredAsset?: 'ETH' | 'WETH' | 'ALL';
  ethToWrap: bigint;
}): DepositExecutionRoute {
  if (!options.isWethVault || options.ethToWrap === BigInt(0)) return 'erc4626';
  return options.preferredAsset === 'ETH' ? 'vault-bundles-v1' : 'bundler3';
}

/** Address whose `canSendAssets` permission is used by this deposit route. */
export function getVaultDepositCaller(
  route: DepositExecutionRoute,
  wallet: Address
): Address {
  if (route === 'vault-bundles-v1') return VAULT_BUNDLES_V1_ADDRESS;
  if (route === 'bundler3') return GENERAL_ADAPTER_ADDRESS;
  return wallet;
}

/** Token spender and amount for routes that need an ERC-20 approval. */
export function getVaultDepositApproval(options: {
  route: DepositExecutionRoute;
  vault: Address;
  totalAssets: bigint;
  wethFromWallet: bigint;
}): { spender: Address; amount: bigint } | null {
  if (options.route === 'vault-bundles-v1') return null;
  if (options.route === 'bundler3') {
    return { spender: GENERAL_ADAPTER_ADDRESS, amount: options.wethFromWallet };
  }
  return { spender: options.vault, amount: options.totalAssets };
}
