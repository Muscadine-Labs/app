/**
 * Transaction utilities for V2 vaults using direct ABI calls and RPC
 * Since the bundler doesn't support v2 vaults yet, we use direct contract interactions
 */

import { type Address, type PublicClient, type WalletClient, type TransactionReceipt, parseUnits, formatUnits, getAddress, parseEventLogs } from 'viem';
import { builderWriteOpts } from './builder-code';
import { BASE_WETH_ADDRESS, ETH_GAS_RESERVE, UNWRAP_SETTLE_DELAY_MS } from './constants';
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
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
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
    name: 'convertToShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'previewRedeem',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// WETH ABI for wrapping/unwrapping
const WETH_ABI = [
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
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;

const ERC20_TRANSFER_EVENT = [
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

async function readWethBalance(
  publicClient: PublicClient,
  ownerAddress: Address,
  blockNumber?: bigint
): Promise<bigint> {
  return publicClient.readContract({
    address: BASE_WETH_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ownerAddress],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  }) as Promise<bigint>;
}

/**
 * RPC `latest` can lag behind a freshly mined receipt. Prefer balance at the
 * confirm block, then poll until the wallet shows enough WETH to unwrap.
 */
async function resolveWethBalanceForUnwrap(
  publicClient: PublicClient,
  ownerAddress: Address,
  requiredAmount: bigint,
  confirmBlockNumber?: bigint,
  maxAttempts = 20,
  delayMs = 500
): Promise<bigint> {
  if (requiredAmount === BigInt(0)) {
    return BigInt(0);
  }

  if (confirmBlockNumber !== undefined) {
    const atConfirmBlock = await readWethBalance(
      publicClient,
      ownerAddress,
      confirmBlockNumber
    );
    if (atConfirmBlock >= requiredAmount) {
      return atConfirmBlock;
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const balance = await readWethBalance(publicClient, ownerAddress);
    if (balance >= requiredAmount) {
      return balance;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const balance = await readWethBalance(publicClient, ownerAddress);

  throw new Error(
    'WETH from your withdrawal is not available to unwrap yet.\n\n' +
      `Expected: ${formatUnits(requiredAmount, 18)} WETH\n` +
      `Wallet WETH balance: ${formatUnits(balance, 18)} WETH\n\n` +
      'Your vault withdrawal likely succeeded. Wait a few seconds, refresh your wallet, ' +
      'then unwrap the WETH balance manually if needed.'
  );
}

/** Sum WETH Transfer logs to the user in a vault withdraw/redeem receipt. */
function getWethReceivedFromReceipt(
  receipt: TransactionReceipt,
  recipient: Address
): bigint {
  const transfers = parseEventLogs({
    abi: ERC20_TRANSFER_EVENT,
    logs: receipt.logs,
    eventName: 'Transfer',
  });

  const recipientLower = recipient.toLowerCase();
  let total = BigInt(0);

  for (const transfer of transfers) {
    if (transfer.address.toLowerCase() !== BASE_WETH_ADDRESS.toLowerCase()) {
      continue;
    }
    const to = transfer.args.to;
    if (to && to.toLowerCase() === recipientLower) {
      total += transfer.args.value ?? BigInt(0);
    }
  }

  return total;
}

const gasReserveWei = parseUnits(ETH_GAS_RESERVE.toString(), 18);

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
 * Check if token approval is needed and approve if necessary
 * @returns true if a reset was needed (caller should account for extra step)
 */
async function ensureApproval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  tokenAddress: Address,
  spenderAddress: Address,
  amount: bigint,
  ownerAddress: Address,
  onProgress?: TransactionProgressCallback,
  stepIndex: number = 0,
  totalSteps: number = 1
): Promise<boolean> {
  // Early return if amount is zero (no approval needed)
  if (amount === BigInt(0)) {
    return false;
  }

  // Check current allowance
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  }) as bigint;

  // If allowance is sufficient, no approval needed
  if (allowance >= amount) {
    return false;
  }

  if (!walletClient.account) {
    throw new Error('Wallet account not available');
  }

  let needsReset = false;
  // Handle USDC-style ERC20s: if allowance > 0 && allowance < amount, reset to 0 first
  if (allowance > BigInt(0) && allowance < amount) {
    needsReset = true;
    onProgress?.({
      type: 'approving',
      stepIndex,
      totalSteps,
      stepLabel: 'Reset approval',
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
      stepLabel: 'Reset approval',
      contractAddress: tokenAddress,
      txHash: resetHash,
    });

    // Wait for reset transaction to be confirmed
    await publicClient.waitForTransactionReceipt({ hash: resetHash });
    // Don't mutate stepIndex here - caller handles step increments
  }

  // Approve only the exact amount needed (more secure than unlimited approval)
  // Use stepIndex + 1 if reset happened, otherwise use stepIndex
  const approvalStepIndex = needsReset ? stepIndex + 1 : stepIndex;
  onProgress?.({
    type: 'approving',
    stepIndex: approvalStepIndex,
    totalSteps,
    stepLabel: 'Approve token',
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
    stepLabel: 'Approve token',
    contractAddress: tokenAddress,
    txHash: approveHash,
  });

  // Wait for approval transaction to be confirmed
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  return needsReset;
}

/**
 * Wrap ETH to WETH if needed
 */
async function wrapEthIfNeeded(
  publicClient: PublicClient,
  walletClient: WalletClient,
  amount: bigint,
  onProgress?: TransactionProgressCallback,
  stepIndex: number = 0,
  totalSteps: number = 1
): Promise<void> {
  if (!walletClient.account) {
    throw new Error('Wallet account not available');
  }

  // Check ETH balance
  const ethBalance = await publicClient.getBalance({
    address: walletClient.account.address,
  });

  if (ethBalance < amount) {
    throw new Error(
      `Insufficient ETH balance.\n\n` +
      `Requested: ${formatUnits(amount, 18)} ETH\n` +
      `Available: ${formatUnits(ethBalance, 18)} ETH\n\n` +
      `Please reduce the amount or add more ETH to your wallet.`
    );
  }

  onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel: 'Wrap ETH',
    txHash: '',
  });

  const wrapHash = await walletClient.writeContract({
    address: BASE_WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: 'deposit',
    value: amount,
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel: 'Wrap ETH',
    txHash: wrapHash,
  });

  await publicClient.waitForTransactionReceipt({ hash: wrapHash });
}

/**
 * Unwrap WETH to ETH
 */
async function unwrapWeth(
  publicClient: PublicClient,
  walletClient: WalletClient,
  amount: bigint,
  onProgress?: TransactionProgressCallback,
  stepIndex: number = 0,
  totalSteps: number = 1,
  confirmBlockNumber?: bigint
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet account not available');
  }

  onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel: 'Unwrap WETH',
    txHash: '',
  });

  await new Promise((resolve) => setTimeout(resolve, UNWRAP_SETTLE_DELAY_MS));

  const wethBalance = await resolveWethBalanceForUnwrap(
    publicClient,
    walletClient.account.address,
    amount,
    confirmBlockNumber
  );
  const unwrapAmount = amount;

  if (unwrapAmount === BigInt(0)) {
    throw new Error(
      'No WETH available to unwrap.\n\n' +
        `Requested: ${formatUnits(amount, 18)} WETH\n` +
        `Wallet WETH balance: ${formatUnits(wethBalance, 18)} WETH`
    );
  }

  const unwrapHash = await walletClient.writeContract({
    address: BASE_WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: 'withdraw',
    args: [unwrapAmount],
    account: walletClient.account,
    chain: undefined,
    ...builderWriteOpts(),
  });

  onProgress?.({
    type: 'confirming',
    stepIndex,
    totalSteps,
    stepLabel: 'Unwrap WETH',
    txHash: unwrapHash,
  });

  await publicClient.waitForTransactionReceipt({ hash: unwrapHash });
  return unwrapHash;
}

/**
 * Approve token spending for vault operations
 * @param amount - The exact amount to approve (in token units with decimals)
 */
export async function approveToken(
  publicClient: PublicClient,
  walletClient: WalletClient,
  tokenAddress: Address,
  spenderAddress: Address,
  amount: bigint,
  onProgress?: TransactionProgressCallback
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const ownerAddress = walletClient.account.address;

  // Check current allowance
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  }) as bigint;

  // If already approved for this amount or more, return early
  if (allowance >= amount) {
    return '';
  }

  // Determine if reset is needed (USDT-style ERC20s: allowance > 0 && allowance < amount)
  const needsReset = allowance > BigInt(0) && allowance < amount;
  const totalSteps = needsReset ? 2 : 1;

  // Handle USDT-style ERC20s: if allowance > 0 && allowance < amount, reset to 0 first
  if (needsReset) {
    onProgress?.({
      type: 'approving',
      stepIndex: 0,
      totalSteps,
      stepLabel: 'Reset approval',
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
      stepIndex: 0,
      totalSteps,
      stepLabel: 'Reset approval',
      contractAddress: tokenAddress,
      txHash: resetHash,
    });

    await publicClient.waitForTransactionReceipt({ hash: resetHash });
  }

  const stepIndex = needsReset ? 1 : 0;

  onProgress?.({
    type: 'approving',
    stepIndex,
    totalSteps,
    stepLabel: 'Approve token',
    contractAddress: tokenAddress,
  });

  // Approve only the exact amount needed (more secure than unlimited approval)
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
    stepIndex,
    totalSteps,
    stepLabel: 'Approve token',
    contractAddress: tokenAddress,
    txHash: approveHash,
  });

  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  return approveHash;
}

/**
 * Deposit assets into a v2 vault
 */
export async function depositToVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  amount: string,
  assetDecimals: number,
  preferredAsset?: 'ETH' | 'WETH' | 'ALL',
  onProgress?: TransactionProgressCallback,
  options?: { skipEthGasReserve?: boolean }
): Promise<string> {
  const effectiveGasReserveWei = options?.skipEthGasReserve ? BigInt(0) : gasReserveWei;
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  // Get vault asset address
  const assetAddress = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'asset',
  }) as Address;

  const isWethVault = assetAddress.toLowerCase() === BASE_WETH_ADDRESS.toLowerCase();

  // Parse amount using centralized function
  const amountBigInt = parseAmount(amount, assetDecimals);

  // Determine if wrapping is needed (read-only operations first)
  let ethToWrap: bigint = BigInt(0);
  if (isWethVault) {
    // Fetch balances
    const existingWeth = await publicClient.readContract({
      address: BASE_WETH_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    }) as bigint;

    const availableEth = await publicClient.getBalance({
      address: userAddress,
    });

    // Reserve ETH for gas fees - clamp to zero if availableEth is less than reserve
    const availableEthAfterReserve = availableEth > effectiveGasReserveWei 
      ? availableEth - effectiveGasReserveWei 
      : BigInt(0);

    const assetPreference = preferredAsset || 'ALL';

    if (assetPreference === 'ETH') {
      if (amountBigInt > availableEthAfterReserve) {
        throw new Error(
          `Insufficient ETH balance.\n\n` +
          `Requested: ${formatUnits(amountBigInt, 18)} ETH\n` +
          `Available: ${formatUnits(availableEthAfterReserve, 18)} ETH\n` +
          `(Reserved ${formatUnits(effectiveGasReserveWei, 18)} ETH for gas)\n\n` +
          `Please reduce the amount or add more ETH to your wallet.`
        );
      }
      ethToWrap = amountBigInt;
    } else if (assetPreference === 'WETH') {
      if (amountBigInt > existingWeth) {
        throw new Error(
          `Insufficient WETH balance.\n\n` +
          `Requested: ${formatUnits(amountBigInt, 18)} WETH\n` +
          `Available: ${formatUnits(existingWeth, 18)} WETH\n\n` +
          `Please reduce the amount or add more WETH to your wallet.`
        );
      }
      ethToWrap = BigInt(0);
    } else {
      // ALL: Use both ETH + WETH (with gas reserve)
      const totalAvailable = existingWeth + availableEthAfterReserve;
      if (amountBigInt > totalAvailable) {
        throw new Error(
          `Insufficient balance for WETH vault deposit.\n\n` +
          `Requested: ${formatUnits(amountBigInt, 18)} WETH\n` +
          `Available: ${formatUnits(totalAvailable, 18)} WETH\n\n` +
          `Breakdown:\n` +
          `  • Existing WETH: ${formatUnits(existingWeth, 18)} WETH\n` +
          `  • Wrappable ETH: ${formatUnits(availableEthAfterReserve, 18)} ETH\n` +
          `  • Reserved for gas: ${formatUnits(effectiveGasReserveWei, 18)} ETH\n\n` +
          `Please reduce the amount or add more funds to your wallet.`
        );
      }
      // Compute ethToWrap = max(0, amountBigInt - existingWeth) but capped to availableEthAfterReserve
      const ethNeeded = amountBigInt > existingWeth ? amountBigInt - existingWeth : BigInt(0);
      ethToWrap = ethNeeded > availableEthAfterReserve ? availableEthAfterReserve : ethNeeded;
      // Clamp to zero to ensure no negative values
      ethToWrap = ethToWrap < BigInt(0) ? BigInt(0) : ethToWrap;
      // Clamp to zero to ensure no negative values
      ethToWrap = ethToWrap < BigInt(0) ? BigInt(0) : ethToWrap;
    }
  }

  // Check if approval is needed (read-only operation)
  const allowance = await publicClient.readContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, normalizedVault],
  }) as bigint;
  
  // Compute totalSteps once from actual actions (before any transactions)
  const needsApproval = allowance < amountBigInt;
  const needsReset = needsApproval && allowance > BigInt(0) && allowance < amountBigInt;
  const needsWrap = ethToWrap > BigInt(0);

  const totalSteps =
    1 +                 // deposit
    (needsWrap ? 1 : 0) + // wrap
    (needsApproval ? 1 : 0) +
    (needsReset ? 1 : 0);

  const planLabels: string[] = [];
  if (needsWrap) planLabels.push('Wrap ETH');
  if (needsReset) {
    planLabels.push('Reset approval', 'Approve token');
  } else if (needsApproval) {
    planLabels.push('Approve token');
  }
  planLabels.push('Deposit');
  emitTransactionPlan(onProgress, planLabels);

  let currentStep = 0;

  // Wrap ETH if needed (now with accurate totalSteps)
  if (needsWrap) {
    await wrapEthIfNeeded(publicClient, walletClient, ethToWrap, onProgress, currentStep, totalSteps);
    currentStep++;
  }

  if (needsApproval) {
    const didReset = await ensureApproval(
      publicClient,
      walletClient,
      assetAddress,
      normalizedVault,
      amountBigInt,
      userAddress,
      onProgress,
      currentStep,
      totalSteps
    );
    currentStep += didReset ? 2 : 1;
  }
  // else: no approval step

  // Deposit to vault
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
    args: [amountBigInt, userAddress], // assets, onBehalf
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

  await publicClient.waitForTransactionReceipt({ hash: depositHash });
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
  preferredAsset?: 'ETH' | 'WETH',
  onProgress?: TransactionProgressCallback
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  // Get vault asset address
  const assetAddress = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'asset',
  }) as Address;

  const isWethVault = assetAddress.toLowerCase() === BASE_WETH_ADDRESS.toLowerCase();

  // Parse amount using centralized function
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

  const totalSteps = isWethVault && preferredAsset === 'ETH' ? 2 : 1; // Withdraw + Unwrap (if needed)
  let currentStep = 0;

  emitTransactionPlan(
    onProgress,
    isWethVault && preferredAsset === 'ETH'
      ? ['Withdraw', 'Unwrap WETH']
      : ['Withdraw']
  );

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

  const withdrawReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
  currentStep++;

  // Unwrap WETH to ETH if requested — amount from this withdraw's receipt logs
  if (isWethVault && preferredAsset === 'ETH') {
    const wethReceived = getWethReceivedFromReceipt(withdrawReceipt, userAddress);
    if (wethReceived === BigInt(0)) {
      throw new Error(
        'No WETH received from vault withdrawal to unwrap.\n\n' +
          'The withdraw completed but no WETH transfer to your wallet was found in the transaction. ' +
          'Check your wallet balance or try again.'
      );
    }
    const unwrapHash = await unwrapWeth(
      publicClient,
      walletClient,
      wethReceived,
      onProgress,
      currentStep,
      totalSteps,
      withdrawReceipt.blockNumber
    );
    return unwrapHash;
  }

  return withdrawHash;
}

/**
 * Redeem (withdraw all) shares from a v2 vault
 */
export async function redeemFromVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  _assetDecimals: number, // Reserved for future use (currently unused as redeem uses full share balance)
  preferredAsset?: 'ETH' | 'WETH',
  onProgress?: TransactionProgressCallback
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  // Get vault asset address
  const assetAddress = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC4626_ABI,
    functionName: 'asset',
  }) as Address;

  const isWethVault = assetAddress.toLowerCase() === BASE_WETH_ADDRESS.toLowerCase();

  // Get user's share balance
  const userShares = await publicClient.readContract({
    address: normalizedVault,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  }) as bigint;

  if (userShares === BigInt(0)) {
    if (isWethVault && preferredAsset === 'ETH') {
      const wethBal = await readWethBalance(publicClient, userAddress);
      if (wethBal > BigInt(0)) {
        throw new Error(
          'No vault shares to redeem.\n\n' +
            `You have ${formatUnits(wethBal, 18)} WETH in your wallet — likely from a ` +
            'previous withdrawal where unwrap did not finish. Unwrap that WETH in your wallet to receive ETH.'
        );
      }
    }
    throw new Error('No shares to redeem');
  }

  const totalSteps = isWethVault && preferredAsset === 'ETH' ? 2 : 1; // Redeem + Unwrap (if needed)
  let currentStep = 0;

  emitTransactionPlan(
    onProgress,
    isWethVault && preferredAsset === 'ETH'
      ? ['Redeem', 'Unwrap WETH']
      : ['Redeem']
  );

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

  const redeemReceipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
  currentStep++;

  // Unwrap WETH to ETH if requested — amount from this redeem's receipt logs
  if (isWethVault && preferredAsset === 'ETH') {
    const wethReceived = getWethReceivedFromReceipt(redeemReceipt, userAddress);
    if (wethReceived === BigInt(0)) {
      throw new Error(
        'No WETH received from vault redemption to unwrap.\n\n' +
          'The redeem completed but no WETH transfer to your wallet was found in the transaction. ' +
          'Check your wallet balance or try again.'
      );
    }
    const unwrapHash = await unwrapWeth(
      publicClient,
      walletClient,
      wethReceived,
      onProgress,
      currentStep,
      totalSteps,
      redeemReceipt.blockNumber
    );
    return unwrapHash;
  }

  return redeemHash;
}

/**
 * Resume only the unwrap step after withdraw/redeem succeeded but unwrap failed.
 * Uses the same receipt-based WETH amount as the initial withdraw/redeem path.
 */
export async function resumeUnwrapWalletWethV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  withdrawOrRedeemTxHash: `0x${string}`,
  onProgress?: TransactionProgressCallback,
  stepIndex: number = 1,
  totalSteps: number = 2
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet account not available');
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: withdrawOrRedeemTxHash });
  const wethReceived = getWethReceivedFromReceipt(receipt, walletClient.account.address);
  if (wethReceived === BigInt(0)) {
    throw new Error(
      'No WETH received from vault withdrawal to unwrap.\n\n' +
        'The withdraw completed but no WETH transfer to your wallet was found in the transaction. ' +
        'Check your wallet balance or try again.'
    );
  }

  return unwrapWeth(
    publicClient,
    walletClient,
    wethReceived,
    onProgress,
    stepIndex,
    totalSteps,
    receipt.blockNumber
  );
}
