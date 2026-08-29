/**
 * Transaction utilities for V2 vaults using direct ERC-4626 + viem.
 * Multi-step WETH/ETH flows use Morpho Bundler3 + GeneralAdapter1 (single user tx).
 */

import { type Address, type PublicClient, type WalletClient, type TransactionReceipt, parseUnits, formatUnits, getAddress, parseEventLogs } from 'viem';
import { builderWriteOpts } from './builder-code';
import {
  buildUnwrapWalletWethBundle,
  buildWethVaultNativeDepositBundle,
  buildWethVaultWithdrawToEthBundle,
  executeBundler3Multicall,
  maxSharePriceE27FromQuote,
  minSharePriceE27FromQuote,
} from './bundler3';
import { BASE_WETH_ADDRESS, ETH_GAS_RESERVE_WEI, GENERAL_ADAPTER_ADDRESS } from './constants';
import type { ForceWithdrawPlan } from './force-withdraw-v2';
import { VAULT_V2_FORCE_ABI } from './force-withdraw-v2';
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
  {
    name: 'convertToShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
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
  ownerAddress: Address
): Promise<bigint> {
  return publicClient.readContract({
    address: BASE_WETH_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ownerAddress],
  }) as Promise<bigint>;
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

const gasReserveWei = ETH_GAS_RESERVE_WEI;

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
  totalSteps: number = 1,
  labels?: { reset?: string; approve?: string }
): Promise<boolean> {
  // Early return if amount is zero (no approval needed)
  if (amount === BigInt(0)) {
    return false;
  }

  const resetLabel = labels?.reset ?? 'Reset approval';
  const approveLabel = labels?.approve ?? 'Approve token';

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

  // Wait for approval transaction to be confirmed
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  return needsReset;
}

/**
 * Withdraw/redeem from a WETH vault and unwrap to ETH via Morpho Bundler3.
 * Approves vault shares to GeneralAdapter1 when needed, then one multicall:
 * erc4626Withdraw/Redeem → unwrapNative.
 */
async function executeVaultWithdrawThenUnwrap(
  publicClient: PublicClient,
  walletClient: WalletClient,
  vaultAddress: Address,
  mode: 'withdraw' | 'redeem',
  assetsOrShares: bigint,
  onProgress?: TransactionProgressCallback
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet account not available');
  }

  const userAddress = walletClient.account.address;
  const normalizedVault = getAddress(vaultAddress);

  const sharesForApproval =
    mode === 'redeem'
      ? assetsOrShares
      : ((await publicClient.readContract({
          address: normalizedVault,
          abi: ERC4626_ABI,
          functionName: 'previewWithdraw',
          args: [assetsOrShares],
        })) as bigint);

  const shareAllowance = (await publicClient.readContract({
    address: normalizedVault,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, GENERAL_ADAPTER_ADDRESS],
  })) as bigint;

  const needsShareApproval = shareAllowance < sharesForApproval;
  const needsReset =
    needsShareApproval && shareAllowance > BigInt(0) && shareAllowance < sharesForApproval;

  const planLabels: string[] = [];
  if (needsReset) planLabels.push('Reset share approval', 'Approve shares');
  else if (needsShareApproval) planLabels.push('Approve shares');
  planLabels.push(mode === 'withdraw' ? 'Withdraw to ETH' : 'Redeem to ETH');
  emitTransactionPlan(onProgress, planLabels);

  let step = 0;
  const totalSteps = planLabels.length;

  if (needsShareApproval) {
    const didReset = await ensureApproval(
      publicClient,
      walletClient,
      normalizedVault,
      GENERAL_ADAPTER_ADDRESS,
      sharesForApproval,
      userAddress,
      onProgress,
      step,
      totalSteps
    );
    step += didReset ? 2 : 1;
  }

  const calls = buildWethVaultWithdrawToEthBundle({
    vault: normalizedVault,
    user: userAddress,
    mode,
    assetsOrShares,
    minSharePriceE27:
      mode === 'withdraw'
        ? minSharePriceE27FromQuote(assetsOrShares, sharesForApproval)
        : minSharePriceE27FromQuote(
            (await publicClient.readContract({
              address: normalizedVault,
              abi: ERC4626_ABI,
              functionName: 'convertToAssets',
              args: [assetsOrShares],
            })) as bigint,
            assetsOrShares
          ),
  });

  return executeBundler3Multicall(publicClient, walletClient, calls, {
    onProgress,
    stepIndex: step,
    totalSteps,
    stepLabel: planLabels[planLabels.length - 1],
  });
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
    const availableEthAfterReserve = availableEth > gasReserveWei 
      ? availableEth - gasReserveWei 
      : BigInt(0);

    const assetPreference = preferredAsset || 'WETH';

    if (assetPreference === 'ETH') {
      if (amountBigInt > availableEthAfterReserve) {
        throw new Error(
          `Insufficient ETH balance.\n\n` +
          `Requested: ${formatUnits(amountBigInt, 18)} ETH\n` +
          `Available: ${formatUnits(availableEthAfterReserve, 18)} ETH\n` +
          `(Reserved ${formatUnits(gasReserveWei, 18)} ETH for gas)\n\n` +
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
          `  • Reserved for gas: ${formatUnits(gasReserveWei, 18)} ETH\n\n` +
          `Please reduce the amount or add more funds to your wallet.`
        );
      }
      // Compute ethToWrap = max(0, amountBigInt - existingWeth) but capped to availableEthAfterReserve
      const ethNeeded = amountBigInt > existingWeth ? amountBigInt - existingWeth : BigInt(0);
      ethToWrap = ethNeeded > availableEthAfterReserve ? availableEthAfterReserve : ethNeeded;
    }
  }

  // Check if approval is needed (read-only operation)
  // Bundler deposits pull WETH via GeneralAdapter; direct deposits approve the vault.
  const approvalSpender = isWethVault && ethToWrap > BigInt(0)
    ? GENERAL_ADAPTER_ADDRESS
    : normalizedVault;
  const wethFromWalletForBundler =
    isWethVault && ethToWrap > BigInt(0)
      ? amountBigInt > ethToWrap
        ? amountBigInt - ethToWrap
        : BigInt(0)
      : BigInt(0);

  const allowance = (await publicClient.readContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, approvalSpender],
  })) as bigint;

  const useBundlerDeposit = isWethVault && ethToWrap > BigInt(0);
  const needsApproval =
    useBundlerDeposit
      ? wethFromWalletForBundler > BigInt(0) && allowance < wethFromWalletForBundler
      : allowance < amountBigInt;
  const needsReset = needsApproval && allowance > BigInt(0) && allowance < (useBundlerDeposit ? wethFromWalletForBundler : amountBigInt);

  const totalSteps =
    1 + // deposit or bundler deposit
    (needsApproval ? 1 : 0) +
    (needsReset ? 1 : 0);

  const planLabels: string[] = [];
  if (needsReset) {
    planLabels.push('Reset approval', 'Approve token');
  } else if (needsApproval) {
    planLabels.push('Approve token');
  }
  planLabels.push(useBundlerDeposit ? 'Deposit (wrap ETH)' : 'Deposit');
  emitTransactionPlan(onProgress, planLabels);

  let currentStep = 0;

  if (needsApproval) {
    const didReset = await ensureApproval(
      publicClient,
      walletClient,
      assetAddress,
      approvalSpender,
      useBundlerDeposit ? wethFromWalletForBundler : amountBigInt,
      userAddress,
      onProgress,
      currentStep,
      totalSteps
    );
    currentStep += didReset ? 2 : 1;
  }

  if (useBundlerDeposit) {
    const expectedShares = (await publicClient.readContract({
      address: normalizedVault,
      abi: ERC4626_ABI,
      functionName: 'convertToShares',
      args: [amountBigInt],
    })) as bigint;
    const calls = buildWethVaultNativeDepositBundle({
      vault: normalizedVault,
      user: userAddress,
      ethToWrap,
      wethFromWallet: wethFromWalletForBundler,
      totalAssets: amountBigInt,
      maxSharePriceE27: maxSharePriceE27FromQuote(amountBigInt, expectedShares),
    });
    return executeBundler3Multicall(publicClient, walletClient, calls, {
      value: ethToWrap,
      onProgress,
      stepIndex: currentStep,
      totalSteps,
      stepLabel: 'Deposit (wrap ETH)',
    });
  }

  // Direct ERC-4626 deposit (no native wrap)
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

  const totalSteps = 1;
  const currentStep = 0;

  if (isWethVault && preferredAsset === 'ETH') {
    return executeVaultWithdrawThenUnwrap(
      publicClient,
      walletClient,
      normalizedVault,
      'withdraw',
      amountBigInt,
      onProgress
    );
  }

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

  await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
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
            `You have ${formatUnits(wethBal, 18)} WETH in your wallet. ` +
            'If this is leftover from a force withdraw to ETH where unwrap failed, use Try again to unwrap, or unwrap WETH in your wallet.'
        );
      }
    }
    throw new Error('No shares to redeem');
  }

  const totalSteps = 1;

  if (isWethVault && preferredAsset === 'ETH') {
    return executeVaultWithdrawThenUnwrap(
      publicClient,
      walletClient,
      normalizedVault,
      'redeem',
      userShares,
      onProgress
    );
  }

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

  await publicClient.waitForTransactionReceipt({ hash: redeemHash });
  return redeemHash;
}

/**
 * Resume only the unwrap step after a prior exit left WETH in the wallet
 * (force-withdraw → ETH). Uses Bundler3: transferFrom WETH → adapter → unwrapNative.
 *
 * Amount is taken from WETH Transfer logs in the prior exit receipt only —
 * never falls back to the full wallet WETH balance.
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

  const userAddress = walletClient.account.address;
  const receipt = await publicClient.getTransactionReceipt({ hash: withdrawOrRedeemTxHash });
  if (receipt.status !== 'success') {
    throw new Error(
      'Previous exit transaction did not succeed.\n\n' +
        'Use Start over to withdraw again.'
    );
  }
  const wethAmount = getWethReceivedFromReceipt(receipt, userAddress);
  if (wethAmount === BigInt(0)) {
    throw new Error(
      'Previous exit did not deliver WETH to your wallet.\n\n' +
        'Use Start over to withdraw again, or unwrap any WETH in your wallet manually.'
    );
  }

  const walletWeth = await readWethBalance(publicClient, userAddress);
  if (walletWeth < wethAmount) {
    throw new Error(
      'Wallet WETH balance is lower than the amount from the previous exit.\n\n' +
        'It may already have been unwrapped. Use Start over if you still need to withdraw.'
    );
  }

  const allowance = (await publicClient.readContract({
    address: BASE_WETH_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, GENERAL_ADAPTER_ADDRESS],
  })) as bigint;

  let step = stepIndex;
  let steps = totalSteps;
  if (allowance < wethAmount) {
    emitTransactionPlan(onProgress, ['Approve WETH', 'Unwrap WETH']);
    steps = 2;
    step = 0;
    await ensureApproval(
      publicClient,
      walletClient,
      BASE_WETH_ADDRESS,
      GENERAL_ADAPTER_ADDRESS,
      wethAmount,
      userAddress,
      onProgress,
      0,
      2,
      { reset: 'Reset WETH approval', approve: 'Approve WETH' }
    );
    step = 1;
  } else {
    emitTransactionPlan(onProgress, ['Unwrap WETH']);
  }

  return executeBundler3Multicall(
    publicClient,
    walletClient,
    buildUnwrapWalletWethBundle(userAddress, wethAmount),
    {
      onProgress,
      stepIndex: step,
      totalSteps: steps,
      stepLabel: 'Unwrap WETH',
    }
  );
}

/**
 * Force withdraw when instant liquidity is insufficient:
 * vault.multicall([forceDeallocate × N, withdraw]) using a pre-built plan.
 * Optional WETH → ETH unwrap via Bundler3 as a follow-up tx.
 */
export async function forceWithdrawFromVaultV2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  plan: ForceWithdrawPlan,
  preferredAsset?: 'ETH' | 'WETH',
  onProgress?: TransactionProgressCallback
): Promise<string> {
  if (!walletClient.account) {
    throw new Error('Wallet not connected');
  }

  if (plan.multicallArgs.length === 0 || plan.expectedAssetsOut <= BigInt(0)) {
    throw new Error('Invalid force withdraw plan.');
  }

  const userAddress = walletClient.account.address;
  const assetAddress = (await publicClient.readContract({
    address: plan.vaultAddress,
    abi: ERC4626_ABI,
    functionName: 'asset',
  })) as Address;

  const isWethVault = assetAddress.toLowerCase() === BASE_WETH_ADDRESS.toLowerCase();
  const unwrapToEth = isWethVault && preferredAsset === 'ETH';

  let needsWethApproval = false;
  let needsWethReset = false;
  if (unwrapToEth) {
    const allowance = (await publicClient.readContract({
      address: BASE_WETH_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [userAddress, GENERAL_ADAPTER_ADDRESS],
    })) as bigint;
    needsWethApproval = allowance < plan.expectedAssetsOut;
    needsWethReset =
      needsWethApproval && allowance > BigInt(0) && allowance < plan.expectedAssetsOut;
  }

  const planLabels: string[] = ['Force withdraw'];
  if (unwrapToEth) {
    if (needsWethReset) planLabels.push('Reset WETH approval', 'Approve WETH');
    else if (needsWethApproval) planLabels.push('Approve WETH');
    planLabels.push('Unwrap to ETH');
  }
  const totalSteps = planLabels.length;
  emitTransactionPlan(onProgress, planLabels);

  onProgress?.({
    type: 'confirming',
    stepIndex: 0,
    totalSteps,
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
    totalSteps,
    stepLabel: 'Force withdraw',
    txHash: forceHash,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: forceHash });

  if (receipt.status !== 'success') {
    throw new Error('Force withdraw transaction failed.');
  }

  if (!unwrapToEth) {
    return forceHash;
  }

  const wethAmount = getWethReceivedFromReceipt(receipt, userAddress);
  if (wethAmount === BigInt(0)) {
    throw new Error(
      'Force withdraw did not deliver WETH to unwrap.\n\n' +
        'Check your wallet for WETH, or withdraw again with WETH selected.'
    );
  }

  let step = 1;
  const allowanceAfterExit = (await publicClient.readContract({
    address: BASE_WETH_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, GENERAL_ADAPTER_ADDRESS],
  })) as bigint;

  if (allowanceAfterExit < wethAmount) {
    const needsResetNow =
      allowanceAfterExit > BigInt(0) && allowanceAfterExit < wethAmount;
    const effectiveTotal = Math.max(totalSteps, step + (needsResetNow ? 2 : 1) + 1);
    const didReset = await ensureApproval(
      publicClient,
      walletClient,
      BASE_WETH_ADDRESS,
      GENERAL_ADAPTER_ADDRESS,
      wethAmount,
      userAddress,
      onProgress,
      step,
      effectiveTotal,
      { reset: 'Reset WETH approval', approve: 'Approve WETH' }
    );
    step += didReset ? 2 : 1;
    return executeBundler3Multicall(
      publicClient,
      walletClient,
      buildUnwrapWalletWethBundle(userAddress, wethAmount),
      {
        onProgress,
        stepIndex: step,
        totalSteps: effectiveTotal,
        stepLabel: 'Unwrap to ETH',
      }
    );
  }

  return executeBundler3Multicall(
    publicClient,
    walletClient,
    buildUnwrapWalletWethBundle(userAddress, wethAmount),
    {
      onProgress,
      stepIndex: step,
      totalSteps,
      stepLabel: 'Unwrap to ETH',
    }
  );
}
