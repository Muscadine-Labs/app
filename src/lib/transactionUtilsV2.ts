/**
 * Transaction utilities for V2 vaults.
 * Deposits, withdraws, and redeems are direct ERC-4626 and pay the vault asset.
 * Force exits use vault.multicall.
 * WETH vaults can also take native ETH (wrap first) and pay native ETH (unwrap after),
 * through the WETH contract only; see `native-eth.ts` for how the unwrap amount is chosen.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, type TransactionReceipt, concat, encodeFunctionData, parseUnits, formatUnits, getAddress } from 'viem';
import { builderWriteOpts, getBuilderDataSuffix } from './builder-code';
import { BASE_WETH_ADDRESS } from './constants';
import {
  type DepositFunding,
  type ExitAsset,
  type NativeCall,
  SMART_WALLET_UNWRAP_NOTE,
  buildUnwrapCall,
  canReceiveWethUnwrap,
  buildWrapCall,
  planDepositWrap,
  supportsAtomicBatch,
  wethPaidByVault,
} from './native-eth';
import { isCancellationError } from './transactionUtils';
import { VaultDepositBlockedError, isWalletDepositBlocked } from './vault-gates';
import { assertDepositWithinCapacity } from './deposit-capacity';
import type { ForceWithdrawPlan } from './force-withdraw-v2';
import { planForceWithdrawV2, VAULT_V2_FORCE_ABI } from './force-withdraw-v2';
import type { TransactionProgressCallback } from '../types/transactions';

// ERC20 ABI for approvals and balance checks
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

// ERC4626 ABI for vault operations
const ERC4626_ABI = [
  {
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'previewWithdraw',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function readVaultAssetDecimals(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<number> {
  const assetAddress = (await publicClient.readContract({
    address: vaultAddress,
    abi: ERC4626_ABI,
    functionName: 'asset',
  })) as Address;
  const decimals = await publicClient.readContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });
  return Number(decimals);
}

function emitTransactionPlan(
  onProgress: TransactionProgressCallback | undefined,
  stepLabels: string[]
): void {
  if (!onProgress || stepLabels.length === 0) return;
  onProgress({
    type: 'planned',
    totalSteps: stepLabels.length,
    stepLabels,
  });
}

async function waitForSuccessfulReceipt(
  publicClient: PublicClient,
  hash: `0x${string}`,
  label: string
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`${label} transaction failed.`);
  }
  return receipt;
}

function withBuilderSuffix(data: Hex): Hex {
  const suffix = getBuilderDataSuffix();
  return suffix ? concat([data, suffix]) : data;
}

/** Send one call as its own transaction, report progress, and wait for a successful receipt. */
async function sendCallStep(
  publicClient: PublicClient,
  walletClient: WalletClient,
  call: NativeCall,
  step: {
    label: string;
    kind: 'approving' | 'confirming';
    stepIndex: number;
    totalSteps: number;
    onProgress?: TransactionProgressCallback;
    onSent?: (hash: Hex) => void;
  }
): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  if (!walletClient.account) throw new Error('Wallet not connected');
  const report = (txHash?: Hex) => {
    if (step.kind === 'approving') {
      step.onProgress?.({
        type: 'approving',
        stepIndex: step.stepIndex,
        totalSteps: step.totalSteps,
        stepLabel: step.label,
        contractAddress: call.to,
        txHash,
      });
    } else {
      step.onProgress?.({
        type: 'confirming',
        stepIndex: step.stepIndex,
        totalSteps: step.totalSteps,
        stepLabel: step.label,
        txHash: txHash ?? '',
      });
    }
  };

  report();
  const hash = await walletClient.sendTransaction({
    account: walletClient.account,
    chain: undefined,
    to: call.to,
    data: withBuilderSuffix(call.data),
    value: call.value,
  });
  step.onSent?.(hash);
  report(hash);
  const receipt = await waitForSuccessfulReceipt(publicClient, hash, step.label);
  return { hash, receipt };
}

/** Wallet errors that mean "no batch support here", so the calls go one by one instead. */
function isBatchUnsupportedError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? Number((error as { code?: unknown }).code)
      : NaN;
  if (code === 4200 || code === 5700 || code === -32601) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('wallet_sendcalls') ||
    message.includes('method not found') ||
    message.includes('not supported')
  );
}

/**
 * Send calls as one atomic batch (EIP-5792). Returns null when the wallet turns out not to
 * support it, so the caller sends them one by one. A user rejection is rethrown.
 */
async function trySendAtomicBatch(
  walletClient: WalletClient,
  calls: NativeCall[],
  step: {
    label: string;
    stepIndex: number;
    totalSteps: number;
    onProgress?: TransactionProgressCallback;
  }
): Promise<Hex | null> {
  if (!walletClient.account) throw new Error('Wallet not connected');
  step.onProgress?.({
    type: 'confirming',
    stepIndex: step.stepIndex,
    totalSteps: step.totalSteps,
    stepLabel: step.label,
    txHash: '',
  });

  let id: string;
  try {
    ({ id } = await walletClient.sendCalls({
      account: walletClient.account,
      chain: undefined,
      forceAtomic: true,
      calls: calls.map((call) => ({
        to: call.to,
        data: withBuilderSuffix(call.data),
        value: call.value,
      })),
    }));
  } catch (error) {
    if (!isCancellationError(error) && isBatchUnsupportedError(error)) return null;
    throw error;
  }

  const result = await walletClient.waitForCallsStatus({
    id,
    timeout: 5 * 60_000,
    throwOnFailure: true,
  });
  const receipts = result.receipts ?? [];
  if (
    result.status !== 'success' ||
    receipts.length === 0 ||
    receipts.some((receipt) => receipt.status !== 'success')
  ) {
    throw new Error(`${step.label} transaction failed.`);
  }
  const hash = receipts[receipts.length - 1].transactionHash;
  step.onProgress?.({
    type: 'confirming',
    stepIndex: step.stepIndex,
    totalSteps: step.totalSteps,
    stepLabel: step.label,
    txHash: hash,
  });
  return hash;
}

const UNWRAP_LABEL = 'Unwrap to ETH';

async function assertWethVault(publicClient: PublicClient, vault: Address): Promise<void> {
  const asset = (await publicClient.readContract({
    address: vault,
    abi: ERC4626_ABI,
    functionName: 'asset',
  })) as Address;
  if (asset.toLowerCase() !== BASE_WETH_ADDRESS.toLowerCase()) {
    throw new Error('Native ETH is only available for WETH vaults.');
  }
}

/**
 * Unwrap exactly the WETH this vault exit paid the user (read from its receipt), never the
 * wallet's WETH balance, so WETH the wallet already held stays WETH.
 */
async function unwrapExitReceipt(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vault: Address,
  exitReceipt: TransactionReceipt,
  step: {
    stepIndex: number;
    totalSteps: number;
    onProgress?: TransactionProgressCallback;
    onSent?: (hash: Hex) => void;
  }
): Promise<Hex> {
  if (!walletClient.account) throw new Error('Wallet not connected');
  const user = getAddress(walletClient.account.address);
  const paid = wethPaidByVault(exitReceipt, vault, user);
  if (paid === BigInt(0)) {
    throw new Error('The withdraw did not pay WETH to your wallet, so there is nothing to unwrap.');
  }
  const wethBalance = (await publicClient.readContract({
    address: BASE_WETH_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [user],
  })) as bigint;
  if (wethBalance < paid) {
    throw new Error(
      `Your withdraw went through and paid ${formatUnits(paid, 18)} WETH, but your wallet now holds less WETH than that, so it was not unwrapped.`
    );
  }
  const { hash } = await sendCallStep(publicClient, walletClient, buildUnwrapCall(paid), {
    label: UNWRAP_LABEL,
    kind: 'confirming',
    ...step,
  });
  return hash;
}

/**
 * Resume after an exit to ETH whose unwrap did not go through: unwrap exactly what that
 * exit paid. Never re-sends the exit.
 *
 * `priorUnwrapHash` is an unwrap already sent for this exit. If it was mined, nothing more is
 * sent; if it is still pending, it is waited on. Only a reverted (or never sent) unwrap is sent
 * again, so a lost confirmation can never unwrap twice and eat WETH the wallet held before.
 */
export async function unwrapExitProceedsV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  exitHash: Hex,
  onProgress?: TransactionProgressCallback,
  options: { priorUnwrapHash?: Hex | null; onUnwrapSent?: (hash: Hex) => void } = {}
): Promise<string> {
  const step = { stepIndex: 1, totalSteps: 2, onProgress };
  emitTransactionPlan(onProgress, ['Withdraw', UNWRAP_LABEL]);

  if (options.priorUnwrapHash) {
    let prior: TransactionReceipt | null = null;
    try {
      prior = await publicClient.waitForTransactionReceipt({
        hash: options.priorUnwrapHash,
        timeout: 90_000,
      });
    } catch {
      throw new Error(
        'Your earlier unwrap transaction has not confirmed yet. Check your wallet activity before trying again, so it is not sent twice.'
      );
    }
    if (prior.status === 'success') {
      onProgress?.({
        type: 'confirming',
        stepIndex: 1,
        totalSteps: 2,
        stepLabel: UNWRAP_LABEL,
        txHash: options.priorUnwrapHash,
      });
      return options.priorUnwrapHash;
    }
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: exitHash });
  if (receipt.status !== 'success') {
    throw new Error('The withdraw transaction did not succeed. Use Start over to withdraw again.');
  }
  return unwrapExitReceipt(publicClient, walletClient, getAddress(vaultAddress), receipt, {
    ...step,
    onSent: options.onUnwrapSent,
  });
}

/**
 * Exit a WETH vault to native ETH. `exitCall` is the vault call (withdraw, redeem, or the force
 * multicall). When it pays a known amount (`knownAssets`, from `withdraw(assets)`) and the wallet
 * batches atomically, exit and unwrap go in one batch. Otherwise the exit is sent, then its
 * receipt sets the unwrap amount.
 */
async function exitToEth(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vault: Address,
  exitCall: NativeCall,
  exitLabel: string,
  knownAssets: bigint | null,
  onProgress?: TransactionProgressCallback,
  onExitConfirmed?: (hash: Hex) => void,
  onUnwrapSent?: (hash: Hex) => void
): Promise<string> {
  // Check before the exit: a wallet that cannot receive the unwrap would be left with WETH.
  if (walletClient.account) {
    const canReceive = await canReceiveWethUnwrap(
      publicClient,
      getAddress(walletClient.account.address)
    );
    if (canReceive === false) throw new Error(SMART_WALLET_UNWRAP_NOTE);
  }

  if (knownAssets !== null && knownAssets > BigInt(0) && (await supportsAtomicBatch(walletClient))) {
    const label = `${exitLabel} to ETH`;
    emitTransactionPlan(onProgress, [label]);
    const hash = await trySendAtomicBatch(
      walletClient,
      [exitCall, buildUnwrapCall(knownAssets)],
      { label, stepIndex: 0, totalSteps: 1, onProgress }
    );
    if (hash) return hash;
  }

  emitTransactionPlan(onProgress, [exitLabel, UNWRAP_LABEL]);
  const { hash: exitHash, receipt } = await sendCallStep(publicClient, walletClient, exitCall, {
    label: exitLabel,
    kind: 'confirming',
    stepIndex: 0,
    totalSteps: 2,
    onProgress,
  });
  onExitConfirmed?.(exitHash);
  return unwrapExitReceipt(publicClient, walletClient, vault, receipt, {
    stepIndex: 1,
    totalSteps: 2,
    onProgress,
    onSent: onUnwrapSent,
  });
}

/**
 * Parse and validate amount string, converting to bigint
 * Truncates decimals if user enters more than assetDecimals
 */
function parseAmount(amount: string, decimals: number): bigint {
  let sanitizedAmount = amount.trim().replace(/\s+/g, '');
  
  // Normalize: if amount starts with decimal point, prepend "0"
  // This allows inputs like ".00003" to be valid
  if (sanitizedAmount.startsWith('.')) {
    sanitizedAmount = '0' + sanitizedAmount;
  }
  
  // Validate format: must be a valid decimal number
  // Allows: "123", "123.456", "0.123", ".123" (normalized to "0.123")
  if (!/^\d+\.?\d*$/.test(sanitizedAmount)) {
    throw new Error(`Invalid amount format: "${amount}". Expected a decimal number.`);
  }

  const parts = sanitizedAmount.split('.');
  const integerPart = parts[0] || '0';
  const decimalPart = parts[1] || '';

  // Special case for 0-decimal assets (e.g., whole tokens only)
  if (decimals === 0) {
    // Check if decimalPart contains any non-zero digit
    if (decimalPart && /[1-9]/.test(decimalPart)) {
      throw new Error(`Fractional input not allowed for 0-decimal assets. Received: "${amount}"`);
    }
    // Use just integerPart (no decimal point) for 0-decimal assets
    return parseUnits(integerPart, 0);
  }

  // Truncate decimals if user entered more than allowed
  const truncatedDecimal = decimalPart.slice(0, decimals);
  const paddedDecimal = truncatedDecimal.padEnd(decimals, '0');
  const normalizedAmount = `${integerPart}.${paddedDecimal}`;
  return parseUnits(normalizedAmount, decimals);
}

/**
 * Approve `amount` of `tokenAddress` for `spenderAddress`. `allowance` is the caller's fresh read.
 * USDC-style tokens need a reset to 0 first when a smaller allowance is already set.
 * @returns true if a reset was sent (caller should account for the extra step)
 */
async function ensureApproval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  tokenAddress: Address,
  spenderAddress: Address,
  amount: bigint,
  allowance: bigint,
  onProgress: TransactionProgressCallback | undefined,
  stepIndex: number,
  totalSteps: number
): Promise<boolean> {
  if (amount === BigInt(0) || allowance >= amount) {
    return false;
  }

  if (!walletClient.account) {
    throw new Error('Wallet account not available');
  }

  const resetLabel = 'Reset approval';
  const approveLabel = 'Approve token';

  const needsReset = allowance > BigInt(0);
  if (needsReset) {
    onProgress?.({
      type: 'approving',
      stepIndex,
      totalSteps,
      stepLabel: resetLabel,
      contractAddress: tokenAddress,
    });

    const resetHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spenderAddress, BigInt(0)],
      account: walletClient.account,
      chain: undefined,
      ...builderWriteOpts(),
    });

    onProgress?.({
      type: 'approving',
      stepIndex,
      totalSteps,
      stepLabel: resetLabel,
      contractAddress: tokenAddress,
      txHash: resetHash,
    });

    await waitForSuccessfulReceipt(publicClient, resetHash, resetLabel);
  }

  // Approve only the exact amount needed (more secure than unlimited approval)
  const approvalStepIndex = needsReset ? stepIndex + 1 : stepIndex;
  onProgress?.({
    type: 'approving',
    stepIndex: approvalStepIndex,
    totalSteps,
    stepLabel: approveLabel,
    contractAddress: tokenAddress,
  });

  const approveHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, amount],
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'approving',
    stepIndex: approvalStepIndex,
    totalSteps,
    stepLabel: approveLabel,
    contractAddress: tokenAddress,
    txHash: approveHash,
  });

  await waitForSuccessfulReceipt(publicClient, approveHash, approveLabel);
  return needsReset;
}

/**
 * Wrap `wrap` ETH, approve WETH to the vault if needed, then deposit `amount` WETH.
 * One atomic batch when the wallet supports it, otherwise one transaction per step.
 * WETH approves over a nonzero allowance, so no reset step.
 */
async function depositWrappingEth(
  publicClient: PublicClient,
  walletClient: WalletClient,
  params: {
    vault: Address;
    user: Address;
    amount: bigint;
    wrap: bigint;
    allowance: bigint;
    onProgress?: TransactionProgressCallback;
    onWrapped?: (amount: bigint) => void;
  }
): Promise<string> {
  const { vault, user, amount, wrap, allowance, onProgress, onWrapped } = params;
  const wrapCall = buildWrapCall(wrap);
  const approveCall: NativeCall | null =
    allowance < amount
      ? {
          to: BASE_WETH_ADDRESS,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [vault, amount] }),
        }
      : null;
  const depositCall: NativeCall = {
    to: vault,
    data: encodeFunctionData({ abi: ERC4626_ABI, functionName: 'deposit', args: [amount, user] }),
  };

  if (await supportsAtomicBatch(walletClient)) {
    const label = 'Wrap ETH and deposit';
    emitTransactionPlan(onProgress, [label]);
    const hash = await trySendAtomicBatch(
      walletClient,
      approveCall ? [wrapCall, approveCall, depositCall] : [wrapCall, depositCall],
      { label, stepIndex: 0, totalSteps: 1, onProgress }
    );
    if (hash) return hash;
  }

  const labels = approveCall ? ['Wrap ETH', 'Approve token', 'Deposit'] : ['Wrap ETH', 'Deposit'];
  emitTransactionPlan(onProgress, labels);
  const totalSteps = labels.length;
  let stepIndex = 0;

  await sendCallStep(publicClient, walletClient, wrapCall, {
    label: 'Wrap ETH',
    kind: 'confirming',
    stepIndex,
    totalSteps,
    onProgress,
  });
  onWrapped?.(wrap);
  stepIndex += 1;

  if (approveCall) {
    await sendCallStep(publicClient, walletClient, approveCall, {
      label: 'Approve token',
      kind: 'approving',
      stepIndex,
      totalSteps,
      onProgress,
    });
    stepIndex += 1;
  }

  const { hash } = await sendCallStep(publicClient, walletClient, depositCall, {
    label: 'Deposit',
    kind: 'confirming',
    stepIndex,
    totalSteps,
    onProgress,
  });
  return hash;
}

export interface DepositOptions {
  /** WETH vaults: fund from WETH (default), ETH, or ETH + WETH. */
  funding?: DepositFunding;
  /** ETH an earlier attempt of this flow wrapped without depositing (sequential wallets). */
  alreadyWrapped?: bigint;
  /** Called once a wrap is mined, with the amount wrapped. */
  onWrapped?: (amount: bigint) => void;
}

export interface ExitOptions {
  /** WETH vaults: receive WETH (default) or ETH. */
  receiveAs?: ExitAsset;
  /** ETH exits sent one by one: called with the exit hash once it is mined, before the unwrap. */
  onExitConfirmed?: (hash: Hex) => void;
  /** Called with the unwrap hash as soon as it is sent, so a retry can check it first. */
  onUnwrapSent?: (hash: Hex) => void;
}

/**
 * Deposit assets into a v2 vault. Direct ERC-4626.
 * WETH vaults can be funded with ETH or ETH + WETH: the ETH shortfall is wrapped first.
 */
export async function depositToVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  amount: string,
  assetDecimals: number,
  onProgress?: TransactionProgressCallback,
  options: DepositOptions = {}
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  const amountBigInt = parseAmount(amount, assetDecimals);

  const [depositBlocked, capError] = await Promise.all([
    isWalletDepositBlocked(publicClient, normalizedVault, userAddress),
    assertDepositWithinCapacity(publicClient, normalizedVault, amountBigInt).then(
      () => null,
      (err: unknown) => err
    ),
  ]);
  if (depositBlocked) throw new VaultDepositBlockedError();
  if (capError) throw capError;

  const assetAddress = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'asset',
  }) as Address;

  const [assetBalance, allowance] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [userAddress] },
      {
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [userAddress, normalizedVault],
      },
    ],
  });

  const funding = options.funding ?? 'WETH';
  if (funding !== 'WETH') {
    if (assetAddress.toLowerCase() !== BASE_WETH_ADDRESS.toLowerCase()) {
      throw new Error('Native ETH is only available for WETH vaults.');
    }
    const wrap = planDepositWrap({
      funding,
      amount: amountBigInt,
      wethBalance: assetBalance,
      ethBalance: await publicClient.getBalance({ address: userAddress }),
      alreadyWrapped: options.alreadyWrapped,
    });
    // Nothing left to wrap (enough WETH, or a retry after the wrap): plain WETH deposit below.
    if (wrap > BigInt(0)) {
      return depositWrappingEth(publicClient, walletClient, {
        vault: normalizedVault,
        user: userAddress,
        amount: amountBigInt,
        wrap,
        allowance,
        onProgress,
        onWrapped: options.onWrapped,
      });
    }
  }

  if (amountBigInt > assetBalance) {
    throw new Error(
      `Insufficient balance.\n\n` +
      `Requested: ${formatUnits(amountBigInt, assetDecimals)}\n` +
      `Available: ${formatUnits(assetBalance, assetDecimals)}\n\n` +
      `Please reduce the amount or add more funds to your wallet.`
    );
  }

  const needsApproval = amountBigInt > BigInt(0) && allowance < amountBigInt;
  const needsReset = needsApproval && allowance > BigInt(0);

  const planLabels: string[] = [];
  if (needsReset) {
    planLabels.push('Reset approval', 'Approve token');
  } else if (needsApproval) {
    planLabels.push('Approve token');
  }
  planLabels.push('Deposit');
  emitTransactionPlan(onProgress, planLabels);

  const totalSteps = planLabels.length;
  let currentStep = 0;

  if (needsApproval) {
    const didReset = await ensureApproval(
      publicClient,
      walletClient,
      assetAddress,
      normalizedVault,
      amountBigInt,
      allowance,
      onProgress,
      currentStep,
      totalSteps
    );
    currentStep += didReset ? 2 : 1;
  }

  onProgress?.({
    type: 'confirming',
    stepIndex: currentStep,
    totalSteps,
    stepLabel: 'Deposit',
    txHash: '',
  });

  const depositHash = await walletClient.writeContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'deposit',
    args: [amountBigInt, userAddress],
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'confirming',
    stepIndex: currentStep,
    totalSteps,
    stepLabel: 'Deposit',
    txHash: depositHash,
  });

  await waitForSuccessfulReceipt(publicClient, depositHash, 'Deposit');
  return depositHash;
}

/**
 * Withdraw assets from a v2 vault
 */
export async function withdrawFromVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  amount: string,
  assetDecimals: number,
  onProgress?: TransactionProgressCallback,
  options: ExitOptions = {}
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  const amountBigInt = parseAmount(amount, assetDecimals);

  // Get user's share balance
  const userShares = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  }) as bigint;

  if (userShares === BigInt(0)) {
    throw new Error('No shares to withdraw');
  }

  // Use previewWithdraw for accurate share calculation (avoids rounding issues)
  const sharesNeeded = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'previewWithdraw',
    args: [amountBigInt],
  }) as bigint;

  // Validate user has enough shares
  if (sharesNeeded > userShares) {
    const availableAssets = await publicClient.readContract({
      address: normalizedVault,
      abi: ERC4626_ABI,
      functionName: 'convertToAssets',
      args: [userShares],
    }) as bigint;

    throw new Error(
      `Insufficient balance for vault withdrawal.\n\n` +
      `Requested: ${formatUnits(amountBigInt, assetDecimals)} assets\n` +
      `Available: ${formatUnits(availableAssets, assetDecimals)} assets\n\n` +
      `Please reduce the amount or deposit more funds to the vault.`
    );
  }

  if (options.receiveAs === 'ETH') {
    await assertWethVault(publicClient, normalizedVault);
    // withdraw(assets) pays exactly `assets`, so the unwrap amount is known up front.
    return exitToEth(
      publicClient,
      walletClient,
      normalizedVault,
      {
        to: normalizedVault,
        data: encodeFunctionData({
          abi: ERC4626_ABI,
          functionName: 'withdraw',
          args: [amountBigInt, userAddress, userAddress],
        }),
      },
      'Withdraw',
      amountBigInt,
      onProgress,
      options.onExitConfirmed,
      options.onUnwrapSent
    );
  }

  const totalSteps = 1;
  const currentStep = 0;

  emitTransactionPlan(onProgress, ['Withdraw']);

  // Withdraw from vault
  onProgress?.({
    type: 'confirming',
    stepIndex: currentStep,
    totalSteps,
    stepLabel: 'Withdraw',
    txHash: '',
  });

  const withdrawHash = await walletClient.writeContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'withdraw',
    args: [amountBigInt, userAddress, userAddress],
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'confirming',
    stepIndex: currentStep,
    totalSteps,
    stepLabel: 'Withdraw',
    txHash: withdrawHash,
  });

  await waitForSuccessfulReceipt(publicClient, withdrawHash, 'Withdraw');
  return withdrawHash;
}

/**
 * Redeem (withdraw all) shares from a v2 vault
 */
export async function redeemFromVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  onProgress?: TransactionProgressCallback,
  options: ExitOptions = {}
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  const userShares = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  }) as bigint;

  if (userShares === BigInt(0)) {
    throw new Error('No shares to redeem');
  }

  if (options.receiveAs === 'ETH') {
    await assertWethVault(publicClient, normalizedVault);
    // Redeem pays an amount fixed only when mined: unwrap from the receipt (no batch).
    return exitToEth(
      publicClient,
      walletClient,
      normalizedVault,
      {
        to: normalizedVault,
        data: encodeFunctionData({
          abi: ERC4626_ABI,
          functionName: 'redeem',
          args: [userShares, userAddress, userAddress],
        }),
      },
      'Redeem',
      null,
      onProgress,
      options.onExitConfirmed,
      options.onUnwrapSent
    );
  }

  const totalSteps = 1;

  emitTransactionPlan(onProgress, ['Redeem']);

  const currentStep = 0;

  // Redeem shares
  onProgress?.({
    type: 'confirming',
    stepIndex: currentStep,
    totalSteps,
    stepLabel: 'Redeem',
    txHash: '',
  });

  const redeemHash = await walletClient.writeContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'redeem',
    args: [userShares, userAddress, userAddress],
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'confirming',
    stepIndex: currentStep,
    totalSteps,
    stepLabel: 'Redeem',
    txHash: redeemHash,
  });

  await waitForSuccessfulReceipt(publicClient, redeemHash, 'Redeem');
  return redeemHash;
}

/**
 * Force withdraw when instant liquidity is insufficient.
 * Force-deallocate illiquid supply, then withdraw or redeem. Pays the vault asset.
 */
export async function forceWithdrawFromVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  plan: ForceWithdrawPlan,
  onProgress?: TransactionProgressCallback,
  options: ExitOptions = {}
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = getAddress(walletClient.account.address);
  const freshPlan = await planForceWithdrawV2(
    publicClient,
    plan.vaultAddress,
    plan.requestedAssets,
    userAddress,
    { useRedeemExit: plan.exitMode === 'redeem' }
  );
  if (!freshPlan) {
    // Instant liquidity now covers the exit: a plain withdraw/redeem is enough.
    if (plan.exitMode === 'redeem') {
      return redeemFromVaultV2(publicClient, walletClient, plan.vaultAddress, onProgress, options);
    }
    const assetDecimals = await readVaultAssetDecimals(publicClient, plan.vaultAddress);
    return withdrawFromVaultV2(
      publicClient,
      walletClient,
      plan.vaultAddress,
      formatUnits(plan.requestedAssets, assetDecimals),
      assetDecimals,
      onProgress,
      options
    );
  }
  plan = freshPlan;

  if (plan.expectedAssetsOut <= BigInt(0) || plan.multicallArgs.length === 0) {
    throw new Error('Invalid force withdraw plan.');
  }

  if (options.receiveAs === 'ETH') {
    await assertWethVault(publicClient, plan.vaultAddress);
    return exitToEth(
      publicClient,
      walletClient,
      plan.vaultAddress,
      {
        to: plan.vaultAddress,
        data: encodeFunctionData({
          abi: VAULT_V2_FORCE_ABI,
          functionName: 'multicall',
          args: [plan.multicallArgs],
        }),
      },
      'Force withdraw',
      // A withdraw exit pays exactly the planned assets; a redeem exit is read from the receipt.
      plan.exitMode === 'withdraw' ? plan.expectedAssetsOut : null,
      onProgress,
      options.onExitConfirmed,
      options.onUnwrapSent
    );
  }

  emitTransactionPlan(onProgress, ['Force withdraw']);

  onProgress?.({
    type: 'confirming',
    stepIndex: 0,
    totalSteps: 1,
    stepLabel: 'Force withdraw',
    txHash: '',
  });

  const forceHash = await walletClient.writeContract({
    address: plan.vaultAddress,
    abi: VAULT_V2_FORCE_ABI,
    functionName: 'multicall',
    args: [plan.multicallArgs],
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'confirming',
    stepIndex: 0,
    totalSteps: 1,
    stepLabel: 'Force withdraw',
    txHash: forceHash,
  });

  await waitForSuccessfulReceipt(publicClient, forceHash, 'Force withdraw');
  return forceHash;
}
