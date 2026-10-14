/**
 * Transaction utilities for V2 vaults.
 * Deposits, withdraws, and redeems are direct ERC-4626 and pay the vault asset.
 * Force exits use vault.multicall.
 */

import { type Address, type PublicClient, type WalletClient, type TransactionReceipt, parseUnits, formatUnits, getAddress } from 'viem';
import { builderWriteOpts } from './builder-code';
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
 * Deposit assets into a v2 vault. Direct ERC-4626. WETH vaults take WETH, not native ETH.
 */
export async function depositToVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  amount: string,
  assetDecimals: number,
  onProgress?: TransactionProgressCallback
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
  onProgress?: TransactionProgressCallback
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
  onProgress?: TransactionProgressCallback
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
  onProgress?: TransactionProgressCallback
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
      return redeemFromVaultV2(publicClient, walletClient, plan.vaultAddress, onProgress);
    }
    const assetDecimals = await readVaultAssetDecimals(publicClient, plan.vaultAddress);
    return withdrawFromVaultV2(
      publicClient,
      walletClient,
      plan.vaultAddress,
      formatUnits(plan.requestedAssets, assetDecimals),
      assetDecimals,
      onProgress
    );
  }
  plan = freshPlan;

  if (plan.expectedAssetsOut <= BigInt(0) || plan.multicallArgs.length === 0) {
    throw new Error('Invalid force withdraw plan.');
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
