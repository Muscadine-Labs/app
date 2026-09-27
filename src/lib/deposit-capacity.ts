/**
 * Vault V2 deposit capacity from on-chain caps.
 *
 * `deposit` → `enter` → `allocateInternal(liquidityAdapter, liquidityData, assets)`. For each id the
 * adapter returns, the vault requires `absoluteCap > 0`, `allocation <= absoluteCap`, and (unless
 * `relativeCap == WAD`) `allocation <= firstTotalAssets * relativeCap / WAD`. `firstTotalAssets` is
 * the accrued total before the deposit, so a deposit does not raise its own relative limit.
 *
 * - Market adapter ids: adapter, collateral token, market. The allocation change is the deposit plus
 *   interest since the last allocation on that market.
 * - Vault adapter (fee wrapper → child vault) ids: adapter only. The deposit then enters the child,
 *   so the child's own liquidity adapter caps also apply.
 * - No liquidity adapter: deposits stay idle and no cap applies.
 *
 * Vault V2 `maxDeposit` always returns 0, so it cannot be used.
 */

import {
  decodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type PublicClient,
} from 'viem';
import { logger } from '@/lib/logger';

const WAD = BigInt(10) ** BigInt(18);
const ZERO = BigInt(0);
const BPS = BigInt(10_000);

/** Input is capped this far below on-chain headroom so interest accrued before the tx lands still fits. */
export const DEPOSIT_CAP_BUFFER_BPS = BigInt(10);

/** Query key prefix for deposit capacity reads. */
export const DEPOSIT_CAPACITY_QUERY_KEY = ['vault-deposit-capacity'] as const;

/** Wrapper → child is one hop. The limit only stops a misconfigured adapter loop. */
const MAX_VAULT_DEPTH = 3;

const VAULT_CAPS_ABI = [
  {
    type: 'function',
    name: 'liquidityAdapter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'liquidityData',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    type: 'function',
    name: 'accrueInterestView',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'newTotalAssets', type: 'uint256' },
      { name: 'performanceFeeShares', type: 'uint256' },
      { name: 'managementFeeShares', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'absoluteCap',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'relativeCap',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allocation',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const MARKET_PARAMS_COMPONENTS = [
  { name: 'loanToken', type: 'address' },
  { name: 'collateralToken', type: 'address' },
  { name: 'oracle', type: 'address' },
  { name: 'irm', type: 'address' },
  { name: 'lltv', type: 'uint256' },
] as const;

const MARKET_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'ids',
    stateMutability: 'view',
    inputs: [{ name: 'marketParams', type: 'tuple', components: MARKET_PARAMS_COMPONENTS }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    type: 'function',
    name: 'allocation',
    stateMutability: 'view',
    inputs: [{ name: 'marketParams', type: 'tuple', components: MARKET_PARAMS_COMPONENTS }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'expectedSupplyAssets',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const VAULT_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'morphoVaultV1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ids',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    type: 'function',
    name: 'allocation',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'realAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const MARKET_PARAMS_ABI = parseAbiParameters(
  'address loanToken, address collateralToken, address oracle, address irm, uint256 lltv'
);

/** Deposit is above what the vault's caps accept. `maxAssets` is the buffered amount the UI should keep. */
export class DepositCapExceededError extends Error {
  readonly maxAssets: bigint;

  constructor(maxAssets: bigint) {
    super(
      maxAssets > ZERO
        ? 'This amount is above what the vault can accept right now because of its deposit caps.'
        : 'This vault is at its deposit cap right now. Try again later, or contact muscadinelabs@gmail.com.'
    );
    this.name = 'DepositCapExceededError';
    this.maxAssets = maxAssets;
  }
}

export function applyDepositCapBuffer(headroom: bigint): bigint {
  if (headroom <= ZERO) return ZERO;
  return (headroom * (BPS - DEPOSIT_CAP_BUFFER_BPS)) / BPS;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Smallest room left across `ids` once `pendingChange` (interest not yet booked) is added. */
async function readIdsHeadroom(
  publicClient: PublicClient,
  vault: Address,
  ids: readonly `0x${string}`[],
  firstTotalAssets: bigint,
  pendingChange: bigint
): Promise<bigint> {
  if (ids.length === 0) return ZERO;

  const results = await publicClient.multicall({
    allowFailure: false,
    contracts: ids.flatMap((id) => [
      { address: vault, abi: VAULT_CAPS_ABI, functionName: 'absoluteCap' as const, args: [id] as const },
      { address: vault, abi: VAULT_CAPS_ABI, functionName: 'relativeCap' as const, args: [id] as const },
      { address: vault, abi: VAULT_CAPS_ABI, functionName: 'allocation' as const, args: [id] as const },
    ]),
  });

  let headroom: bigint | null = null;
  for (let i = 0; i < ids.length; i++) {
    const absoluteCap = results[i * 3] as bigint;
    const relativeCap = results[i * 3 + 1] as bigint;
    const allocation = results[i * 3 + 2] as bigint;

    let room = ZERO;
    if (absoluteCap > ZERO) {
      const limit =
        relativeCap === WAD
          ? absoluteCap
          : minBigInt(absoluteCap, (firstTotalAssets * relativeCap) / WAD);
      room = limit - allocation - pendingChange;
      if (room < ZERO) room = ZERO;
    }
    headroom = headroom === null ? room : minBigInt(headroom, room);
  }
  return headroom ?? ZERO;
}

async function readHeadroom(
  publicClient: PublicClient,
  vault: Address,
  depth: number
): Promise<bigint | null> {
  if (depth >= MAX_VAULT_DEPTH) {
    throw new Error(`Deposit capacity: vault nesting deeper than ${MAX_VAULT_DEPTH} at ${vault}`);
  }

  const [liquidityAdapterRaw, liquidityData, accrued] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: vault, abi: VAULT_CAPS_ABI, functionName: 'liquidityAdapter' },
      { address: vault, abi: VAULT_CAPS_ABI, functionName: 'liquidityData' },
      { address: vault, abi: VAULT_CAPS_ABI, functionName: 'accrueInterestView' },
    ],
  });

  const liquidityAdapter = getAddress(liquidityAdapterRaw);
  if (liquidityAdapter === zeroAddress) return null;
  const firstTotalAssets = accrued[0];

  if (liquidityData !== '0x') {
    const [loanToken, collateralToken, oracle, irm, lltv] = decodeAbiParameters(
      MARKET_PARAMS_ABI,
      liquidityData
    );
    const marketParams = { loanToken, collateralToken, oracle, irm, lltv };
    const [ids, bookedAllocation, expectedAssets] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        {
          address: liquidityAdapter,
          abi: MARKET_ADAPTER_ABI,
          functionName: 'ids',
          args: [marketParams],
        },
        {
          address: liquidityAdapter,
          abi: MARKET_ADAPTER_ABI,
          functionName: 'allocation',
          args: [marketParams],
        },
        {
          address: liquidityAdapter,
          abi: MARKET_ADAPTER_ABI,
          functionName: 'expectedSupplyAssets',
          args: [keccak256(liquidityData)],
        },
      ],
    });
    return readIdsHeadroom(
      publicClient,
      vault,
      ids,
      firstTotalAssets,
      expectedAssets - bookedAllocation
    );
  }

  // `realAssets` is `previewRedeem(child.balanceOf(adapter))`, the value `allocate` books.
  const [childRaw, ids, bookedAllocation, childAssets] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: liquidityAdapter, abi: VAULT_ADAPTER_ABI, functionName: 'morphoVaultV1' },
      { address: liquidityAdapter, abi: VAULT_ADAPTER_ABI, functionName: 'ids' },
      { address: liquidityAdapter, abi: VAULT_ADAPTER_ABI, functionName: 'allocation' },
      { address: liquidityAdapter, abi: VAULT_ADAPTER_ABI, functionName: 'realAssets' },
    ],
  });
  const [ownHeadroom, childHeadroom] = await Promise.all([
    readIdsHeadroom(publicClient, vault, ids, firstTotalAssets, childAssets - bookedAllocation),
    readHeadroom(publicClient, getAddress(childRaw), depth + 1),
  ]);
  return childHeadroom === null ? ownHeadroom : minBigInt(ownHeadroom, childHeadroom);
}

/**
 * Most assets a deposit can add before a cap reverts it, at the current block.
 * `null` means no cap applies. Throws when a read fails; callers must not treat that as "full".
 */
export async function readVaultDepositCapacity(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<bigint | null> {
  return readHeadroom(publicClient, getAddress(vaultAddress), 0);
}

/**
 * Fresh check right before a deposit, so a cap filled since the form read fails before any
 * approval. Compares against raw headroom so an amount already buffered from an earlier read is
 * not lowered again. A failed read does not block; the chain still enforces the caps.
 */
export async function assertDepositWithinCapacity(
  publicClient: PublicClient,
  vaultAddress: Address,
  assets: bigint
): Promise<void> {
  let headroom: bigint | null;
  try {
    headroom = await readVaultDepositCapacity(publicClient, vaultAddress);
  } catch (err) {
    logger.warn('Deposit capacity read failed; sending without the cap check', {
      vaultAddress,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (headroom !== null && assets > headroom) {
    throw new DepositCapExceededError(applyDepositCapBuffer(headroom));
  }
}
