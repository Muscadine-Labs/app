/**
 * Morpho Bundler3 helpers for atomic multi-step WETH/ETH vault flows on Base.
 * Addresses: https://docs.morpho.org/get-started/resources/addresses/
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
  getAddress,
  maxUint256,
} from 'viem';
import { builderWriteOpts } from '@/lib/builder-code';
import {
  BASE_CHAIN_ID,
  BASE_WETH_ADDRESS,
  BUNDLER3_ADDRESS,
  GENERAL_ADAPTER_ADDRESS,
} from '@/lib/constants';
import { logger } from '@/lib/logger';
import type { TransactionProgressCallback } from '@/types/transactions';

/** Default Bundler3 share-price slippage (0.5%). */
export const BUNDLER_SLIPPAGE_BPS = BigInt(50);

const SHARE_PRICE_SCALE_E27 = BigInt(10) ** BigInt(27);

/**
 * Morpho adapter maxSharePriceE27: max assets paid per share, scaled by 1e27.
 * Quote from convertToShares(assets) → assets/shares, then apply upside tolerance.
 */
export function maxSharePriceE27FromQuote(
  assets: bigint,
  shares: bigint,
  slippageBps: bigint = BUNDLER_SLIPPAGE_BPS
): bigint {
  if (shares === BigInt(0) || assets === BigInt(0)) return maxUint256;
  // Morpho checks assets.rDivUp(shares) <= maxSharePriceE27 (ceil division).
  const price = (assets * SHARE_PRICE_SCALE_E27) / shares;
  return price + (price * slippageBps) / BigInt(10_000) + BigInt(1);
}

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
    name: 'wrapNative',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'unwrapNative',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'erc20TransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'erc4626Deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'assets', type: 'uint256' },
      { name: 'maxSharePriceE27', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
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

function adapterCall(data: Hex, value: bigint = BigInt(0)): Bundler3Call {
  return {
    to: GENERAL_ADAPTER_ADDRESS,
    data,
    value,
    skipRevert: false,
    callbackHash: ZERO_HASH,
  };
}

/**
 * Fund GeneralAdapter1 with native ETH via `receive()` (wrapNative is non-payable).
 * Morpho SDK encodes this as nativeTransfer(user → adapter) → empty calldata + value.
 */
function buildNativeFundAdapterCall(amount: bigint): Bundler3Call {
  return {
    to: GENERAL_ADAPTER_ADDRESS,
    data: '0x' as Hex,
    value: amount,
    skipRevert: false,
    callbackHash: ZERO_HASH,
  };
}

/** Wrap ETH already on the adapter. Always value=0 — fund first with buildNativeFundAdapterCall. */
function buildWrapNativeCall(amount: bigint, receiver: Address = GENERAL_ADAPTER_ADDRESS): Bundler3Call {
  return adapterCall(
    encodeFunctionData({
      abi: GENERAL_ADAPTER_ABI,
      functionName: 'wrapNative',
      args: [amount, receiver],
    })
  );
}

function buildUnwrapNativeCall(amount: bigint, receiver: Address): Bundler3Call {
  return adapterCall(
    encodeFunctionData({
      abi: GENERAL_ADAPTER_ABI,
      functionName: 'unwrapNative',
      args: [amount, receiver],
    })
  );
}

function buildErc20TransferFromCall(
  token: Address,
  receiver: Address,
  amount: bigint
): Bundler3Call {
  return adapterCall(
    encodeFunctionData({
      abi: GENERAL_ADAPTER_ABI,
      functionName: 'erc20TransferFrom',
      args: [token, receiver, amount],
    })
  );
}

function buildErc4626DepositCall(
  vault: Address,
  assets: bigint,
  receiver: Address,
  maxSharePriceE27: bigint
): Bundler3Call {
  return adapterCall(
    encodeFunctionData({
      abi: GENERAL_ADAPTER_ABI,
      functionName: 'erc4626Deposit',
      args: [vault, assets, maxSharePriceE27, receiver],
    })
  );
}

function buildErc4626WithdrawCall(
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

function buildErc4626RedeemCall(
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

/** Atomic ETH(+WETH) → wrap → deposit into a WETH vault. */
export function buildWethVaultNativeDepositBundle(params: {
  vault: Address;
  user: Address;
  ethToWrap: bigint;
  wethFromWallet: bigint;
  totalAssets: bigint;
  /** From convertToShares(totalAssets) + slippage; defaults to maxUint256 if omitted. */
  maxSharePriceE27?: bigint;
}): Bundler3Call[] {
  const {
    vault,
    user,
    ethToWrap,
    wethFromWallet,
    totalAssets,
    maxSharePriceE27 = maxUint256,
  } = params;
  const calls: Bundler3Call[] = [];

  if (ethToWrap > BigInt(0)) {
    // Fund adapter (empty call + value), then wrap — matches Morpho BundlerAction encoding.
    calls.push(buildNativeFundAdapterCall(ethToWrap));
    calls.push(buildWrapNativeCall(ethToWrap, GENERAL_ADAPTER_ADDRESS));
  }
  if (wethFromWallet > BigInt(0)) {
    calls.push(
      buildErc20TransferFromCall(BASE_WETH_ADDRESS, GENERAL_ADAPTER_ADDRESS, wethFromWallet)
    );
  }
  calls.push(buildErc4626DepositCall(vault, totalAssets, user, maxSharePriceE27));
  return calls;
}

/** Atomic vault withdraw/redeem → unwrap WETH to ETH for the user. */
export function buildWethVaultWithdrawToEthBundle(params: {
  vault: Address;
  user: Address;
  mode: 'withdraw' | 'redeem';
  assetsOrShares: bigint;
  /** From assets/shares quote + slippage; defaults to 0 if omitted. */
  minSharePriceE27?: bigint;
}): Bundler3Call[] {
  const {
    vault,
    user,
    mode,
    assetsOrShares,
    minSharePriceE27 = BigInt(0),
  } = params;
  const toAdapter = GENERAL_ADAPTER_ADDRESS;

  const exitCall =
    mode === 'withdraw'
      ? buildErc4626WithdrawCall(vault, assetsOrShares, toAdapter, user, minSharePriceE27)
      : buildErc4626RedeemCall(vault, assetsOrShares, toAdapter, user, minSharePriceE27);

  return [
    exitCall,
    // Unwrap whatever the adapter received (handles rounding).
    buildUnwrapNativeCall(maxUint256, user),
  ];
}

/** Unwrap wallet WETH to ETH via adapter (resume / leftover WETH). */
export function buildUnwrapWalletWethBundle(user: Address, amount: bigint): Bundler3Call[] {
  return [
    buildErc20TransferFromCall(BASE_WETH_ADDRESS, GENERAL_ADAPTER_ADDRESS, amount),
    buildUnwrapNativeCall(amount, user),
  ];
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
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }
  if (calls.length === 0) {
    throw new Error('Empty Bundler3 bundle');
  }
  if (!walletClient.chain || walletClient.chain.id !== BASE_CHAIN_ID) {
    throw new Error(
      `Wrong network: Bundler3 is Base-only (chain ${BASE_CHAIN_ID}), got ${walletClient.chain?.id ?? 'unknown'}`
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
    chain: walletClient.chain,
    ...builderWriteOpts(),
  });

  options?.onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel,
    txHash: hash,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
