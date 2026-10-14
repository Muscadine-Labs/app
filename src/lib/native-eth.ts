/**
 * Native ETH for WETH vaults, through the WETH contract only (no bundler).
 *
 * Deposits wrap exactly what is needed (`WETH.deposit`), then deposit WETH into the vault.
 * Exits pay WETH, then unwrap (`WETH.withdraw`) only what that exit paid:
 * - `withdraw(assets)` pays exactly `assets`, so the unwrap amount is known before sending.
 * - `redeem(shares)` pays an amount fixed only when mined (interest accrues while the wallet
 *   signs), so the unwrap reads the exit receipt instead. Unwrapping a quote would leave WETH
 *   dust, and quoting high would unwrap WETH the wallet already held.
 * The wallet's WETH balance is never used as the unwrap amount.
 *
 * Base WETH (WETH9) pays out with Solidity `transfer`, which forwards only 2300 gas. Plain EOAs
 * receive it; smart wallets (Coinbase Smart Wallet / Base Account proxies) and many EIP-7702
 * accounts revert. `canReceiveWethUnwrap` checks this before offering or sending an ETH exit.
 * Wrapping (deposits) works for every wallet.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  encodeFunctionData,
  parseEventLogs,
} from 'viem';
import { BASE_CHAIN_ID, BASE_WETH_ADDRESS, ETH_GAS_RESERVE_WEI } from './constants';

/** Where a WETH vault deposit is funded from. WETH is the default. */
export type DepositFunding = 'WETH' | 'ETH' | 'ALL';
/** What a WETH vault exit pays the wallet. WETH is the default. */
export type ExitAsset = 'WETH' | 'ETH';

export const DEPOSIT_FUNDING_LABELS: Record<DepositFunding, string> = {
  WETH: 'WETH',
  ETH: 'ETH',
  ALL: 'ETH + WETH',
};

export const WETH_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
] as const;

const ERC20_TRANSFER_EVENT_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
] as const;

export type NativeCall = { to: Address; data: Hex; value?: bigint };

export function buildWrapCall(amount: bigint): NativeCall {
  return {
    to: BASE_WETH_ADDRESS,
    data: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit' }),
    value: amount,
  };
}

export function buildUnwrapCall(amount: bigint): NativeCall {
  return {
    to: BASE_WETH_ADDRESS,
    data: encodeFunctionData({ abi: WETH_ABI, functionName: 'withdraw', args: [amount] }),
  };
}

/** ETH the wallet can wrap: its balance minus the gas reserve. */
export function wrappableEth(ethBalance: bigint): bigint {
  return ethBalance > ETH_GAS_RESERVE_WEI ? ethBalance - ETH_GAS_RESERVE_WEI : BigInt(0);
}

/** Most a WETH vault deposit can take from the chosen funding. */
export function maxDepositForFunding(
  funding: DepositFunding,
  wethBalance: bigint,
  ethBalance: bigint
): bigint {
  if (funding === 'WETH') return wethBalance;
  if (funding === 'ETH') return wrappableEth(ethBalance);
  return wethBalance + wrappableEth(ethBalance);
}

/**
 * ETH to wrap before depositing `amount` WETH.
 *
 * `alreadyWrapped` is ETH this flow wrapped in an earlier attempt whose deposit did not go
 * through (sequential wallets); it is counted only while the wallet still holds it, so a
 * retry does not wrap twice. Throws a readable error when the funding cannot cover `amount`.
 */
export function planDepositWrap(options: {
  funding: DepositFunding;
  amount: bigint;
  wethBalance: bigint;
  ethBalance: bigint;
  alreadyWrapped?: bigint;
}): bigint {
  const { funding, amount, wethBalance, ethBalance } = options;
  const zero = BigInt(0);
  const available = wrappableEth(ethBalance);

  if (funding === 'WETH') {
    if (amount > wethBalance) {
      throw new Error('Insufficient WETH balance. Reduce the amount or choose ETH.');
    }
    return zero;
  }

  if (funding === 'ETH') {
    const priorWrap = options.alreadyWrapped ?? zero;
    const wrapped = priorWrap < wethBalance ? priorWrap : wethBalance;
    const wrap = amount > wrapped ? amount - wrapped : zero;
    if (wrap > available) {
      throw new Error(
        'Insufficient ETH balance. 0.0001 ETH stays in your wallet for gas. Reduce the amount or choose ETH + WETH.'
      );
    }
    return wrap;
  }

  // ETH + WETH: spend WETH first, wrap only the shortfall.
  const wrap = amount > wethBalance ? amount - wethBalance : zero;
  if (wrap > available) {
    throw new Error(
      'Insufficient ETH + WETH balance. 0.0001 ETH stays in your wallet for gas. Reduce the amount.'
    );
  }
  return wrap;
}

/**
 * Whether `user` can receive ETH from `WETH.withdraw`: an `eth_call` of `withdraw(0)` from the
 * user runs its receive path under the same 2300-gas limit. `null` when the read itself failed
 * (RPC error), so callers do not block on a flaky node.
 */
export async function canReceiveWethUnwrap(
  publicClient: PublicClient,
  user: Address
): Promise<boolean | null> {
  try {
    await publicClient.call({
      account: user,
      to: BASE_WETH_ADDRESS,
      data: encodeFunctionData({ abi: WETH_ABI, functionName: 'withdraw', args: [BigInt(0)] }),
    });
    return true;
  } catch (error) {
    if (
      error instanceof BaseError &&
      (error.walk((e) => e instanceof ExecutionRevertedError) ||
        error.walk((e) => e instanceof ContractFunctionRevertedError))
    ) {
      return false;
    }
    return null;
  }
}

export const SMART_WALLET_UNWRAP_NOTE =
  'Withdrawing as ETH is not available for this wallet: the WETH contract sends ETH with too little gas for smart wallets. Withdraw as WETH instead.';

/**
 * WETH the vault paid `user` in this receipt: Transfer logs of WETH from the vault to the user.
 * Wrapper vaults pay from the wrapper itself, so the same rule holds for them.
 */
export function wethPaidByVault(
  receipt: Pick<TransactionReceipt, 'logs'>,
  vault: Address,
  user: Address
): bigint {
  const vaultLower = vault.toLowerCase();
  const userLower = user.toLowerCase();
  const transfers = parseEventLogs({
    abi: ERC20_TRANSFER_EVENT_ABI,
    eventName: 'Transfer',
    logs: receipt.logs,
    strict: false,
  });
  let total = BigInt(0);
  for (const log of transfers) {
    if (log.address.toLowerCase() !== BASE_WETH_ADDRESS.toLowerCase()) continue;
    if (log.args.from?.toLowerCase() !== vaultLower) continue;
    if (log.args.to?.toLowerCase() !== userLower) continue;
    total += log.args.value ?? BigInt(0);
  }
  return total;
}

/**
 * True when the wallet runs a batch of calls atomically on Base (EIP-5792), e.g. Base Account
 * and other smart wallets. `ready` (an EOA that would first be upgraded) counts as no, so the
 * wallet is never asked to change account type for a deposit.
 */
export async function supportsAtomicBatch(walletClient: WalletClient): Promise<boolean> {
  if (!walletClient.account) return false;
  try {
    const capabilities = (await walletClient.getCapabilities({
      account: walletClient.account,
      chainId: BASE_CHAIN_ID,
    })) as {
      atomic?: { status?: string };
      atomicBatch?: { supported?: boolean };
    };
    return (
      capabilities?.atomic?.status === 'supported' ||
      capabilities?.atomicBatch?.supported === true
    );
  } catch {
    return false;
  }
}
