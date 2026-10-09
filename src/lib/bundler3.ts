/**
 * Morpho Bundler3 helpers for fee-wrapper force exits on Base.
 * One bundle force-deallocates the child vault, then withdraws the wrapper.
 * Addresses: https://docs.morpho.org/get-started/resources/addresses/
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
  getAddress,
} from 'viem';
import { base } from 'viem/chains';
import { builderWriteOpts } from '@/lib/builder-code';
import {
  BASE_CHAIN_ID,
  BUNDLER3_ADDRESS,
  GENERAL_ADAPTER_ADDRESS,
} from '@/lib/constants';
import { logger } from '@/lib/logger';
import type { TransactionProgressCallback } from '@/types/transactions';

/**
 * Bundler3 share-price slippage, matching Morpho SDK `DEFAULT_SLIPPAGE_TOLERANCE` (0.03%).
 * 3 bps of quoted assets/shares. Tight enough to catch inflation / share-price jumps;
 * loose enough that normal interest accrual during wallet confirmation does not revert.
 */
export const BUNDLER_SLIPPAGE_BPS = BigInt(3);

const SHARE_PRICE_SCALE_E27 = BigInt(10) ** BigInt(27);

/**
 * Morpho adapter minSharePriceE27: min assets received per share, scaled by 1e27.
 */
export function minSharePriceE27FromQuote(
  assets: bigint,
  shares: bigint,
  slippageBps: bigint = BUNDLER_SLIPPAGE_BPS
): bigint {
  if (shares === BigInt(0) || assets === BigInt(0)) return BigInt(0);
  const price = (assets * SHARE_PRICE_SCALE_E27) / shares;
  const slip = (price * slippageBps) / BigInt(10_000);
  return price > slip ? price - slip : BigInt(0);
}

export type Bundler3Call = {
  to: Address;
  data: Hex;
  value: bigint;
  skipRevert: boolean;
  callbackHash: Hex;
};

const BUNDLER3_ABI = [
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'bundle',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'skipRevert', type: 'bool' },
          { name: 'callbackHash', type: 'bytes32' },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const GENERAL_ADAPTER_ABI = [
  {
    name: 'erc4626Withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'assets', type: 'uint256' },
      { name: 'minSharePriceE27', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'erc4626Redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'shares', type: 'uint256' },
      { name: 'minSharePriceE27', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [],
  },
] as const;

const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

/** Call a contract directly from Bundler3 (msg.sender is the bundler). */
export function buildBundlerDirectCall(to: Address, data: Hex): Bundler3Call {
  return {
    to,
    data,
    value: BigInt(0),
    skipRevert: false,
    callbackHash: ZERO_HASH,
  };
}

function adapterCall(data: Hex, value: bigint = BigInt(0)): Bundler3Call {
  return {
    to: GENERAL_ADAPTER_ADDRESS,
    data,
    value,
    skipRevert: false,
    callbackHash: ZERO_HASH,
  };
}

export function buildErc4626WithdrawCall(
  vault: Address,
  assets: bigint,
  receiver: Address,
  owner: Address,
  minSharePriceE27: bigint
): Bundler3Call {
  return adapterCall(
    encodeFunctionData({
      abi: GENERAL_ADAPTER_ABI,
      functionName: 'erc4626Withdraw',
      args: [vault, assets, minSharePriceE27, receiver, owner],
    })
  );
}

export function buildErc4626RedeemCall(
  vault: Address,
  shares: bigint,
  receiver: Address,
  owner: Address,
  minSharePriceE27: bigint
): Bundler3Call {
  return adapterCall(
    encodeFunctionData({
      abi: GENERAL_ADAPTER_ABI,
      functionName: 'erc4626Redeem',
      args: [vault, shares, minSharePriceE27, receiver, owner],
    })
  );
}

export async function executeBundler3Multicall(
  publicClient: PublicClient,
  walletClient: WalletClient,
  calls: Bundler3Call[],
  options?: {
    value?: bigint;
    onProgress?: TransactionProgressCallback;
    stepIndex?: number;
    totalSteps?: number;
    stepLabel?: string;
  }
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }
  if (calls.length === 0) {
    throw new Error('Empty Bundler3 bundle');
  }
  if (walletClient.chain && walletClient.chain.id !== BASE_CHAIN_ID) {
    throw new Error(
      `Wrong network: Bundler3 is Base-only (chain ${BASE_CHAIN_ID}), got ${walletClient.chain.id}`
    );
  }

  const stepIndex = options?.stepIndex ?? 0;
  const totalSteps = options?.totalSteps ?? 1;
  const stepLabel = options?.stepLabel ?? 'Confirm';
  const value =
    options?.value ??
    calls.reduce((sum, call) => sum + call.value, BigInt(0));

  options?.onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel,
    txHash: '',
  });

  logger.info('Executing Bundler3 multicall', {
    bundler: BUNDLER3_ADDRESS,
    adapter: GENERAL_ADAPTER_ADDRESS,
    calls: calls.length,
    value: value.toString(),
  });

  const hash = await walletClient.writeContract({
    address: getAddress(BUNDLER3_ADDRESS),
    abi: BUNDLER3_ABI,
    functionName: 'multicall',
    args: [calls],
    value,
    account: walletClient.account,
    chain: walletClient.chain ?? base,
    ...builderWriteOpts(),
  });

  options?.onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel,
    txHash: hash,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error('Bundler3 transaction failed.');
  }
  return hash;
}
