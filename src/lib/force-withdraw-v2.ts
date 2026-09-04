/**
 * Vault V2 force-withdraw planning — Morpho SDK `forceWithdraw` / `forceRedeem`:
 * vault.multicall([forceDeallocate × N, withdraw|redeem]).
 *
 * This is the cash exit: deallocate illiquid supply into idle, then withdraw the
 * underlying asset (penalty burns shares). It is not in-kind redemption.
 *
 * In-kind (`vault.inKindRedeem` → VaultExitBundlesV1) transfers Morpho Blue
 * supply positions to the user and is a separate path.
 *
 * Used when requested assets exceed instant liquidity (idle + liquidity adapter).
 * Covers MorphoMarketV1 adapters (Blue markets) and fee-wrapper vault adapters
 * (empty deallocate `data`, liquidity = inner vault maxWithdraw(adapter) only).
 * Fee wrappers have a single MorphoVaultV2Adapter — they cannot force-deallocate
 * underlying Blue markets directly; only what the inner vault can release to the adapter.
 * Ref: https://docs.morpho.org/developers/sdks/morpho-sdk/vault/#force-withdraw--force-redeem
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbiParameters,
} from 'viem';
import { logger } from '@/lib/logger';

export const FORCE_DEALLOCATE_WAD = BigInt(10) ** BigInt(18);

export type MorphoMarketParams = {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

export type ForceDeallocationStep = {
  adapter: Address;
  /** Adapter-specific deallocate payload (Blue market params, or `0x` for vault adapters). */
  data: Hex;
  amount: bigint;
  penaltyWad: bigint;
  penaltyAssets: bigint;
};

export type ForceWithdrawPlan = {
  vaultAddress: Address;
  requestedAssets: bigint;
  instantLiquidityAssets: bigint;
  assetsToDeallocate: bigint;
  /** Assets user receives on withdraw exit (equals requested when liquidity covers). Penalty is share burn. */
  expectedAssetsOut: bigint;
  /** Total penalty burned as shares (asset-equivalent), summed across steps. */
  estimatedPenaltyAssets: bigint;
  /** Max penalty rate across adapters actually used in this plan (WAD). */
  maxPenaltyWad: bigint;
  deallocations: ForceDeallocationStep[];
  /** `redeem` on MAX exits (no share dust); otherwise `withdraw(assets)`. */
  exitMode: 'withdraw' | 'redeem';
  /** Inner calls for vault.multicall (forceDeallocate… + withdraw|redeem). */
  multicallArgs: Hex[];
};

const VAULT_V2_FORCE_ABI = [
  {
    name: 'adaptersLength',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'adapters',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'forceDeallocatePenalty',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'adapter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'forceDeallocate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
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
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
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
    name: 'multicall',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [],
  },
] as const;

const ADAPTER_ABI = [
  {
    name: 'morpho',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'marketIdsLength',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'marketIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'expectedSupplyAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const VAULT_ERC4626_ADAPTER_ABI = [
  {
    name: 'realAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'morphoVaultV1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const INNER_VAULT_LIQUIDITY_ABI = [
  {
    name: 'maxWithdraw',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const MORPHO_BLUE_ABI = [
  {
    name: 'idToMarketParams',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
  },
  {
    name: 'market',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ],
  },
] as const;

const MARKET_PARAMS_ABI = parseAbiParameters(
  'address loanToken, address collateralToken, address oracle, address irm, uint256 lltv'
);

function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b + d - BigInt(1)) / d;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function encodeMarketParamsData(params: MorphoMarketParams): Hex {
  return encodeAbiParameters(MARKET_PARAMS_ABI, [
    params.loanToken,
    params.collateralToken,
    params.oracle,
    params.irm,
    params.lltv,
  ]);
}

export function formatPenaltyRatePercent(penaltyWad: bigint): string {
  if (penaltyWad <= BigInt(0)) return '0%';
  // WAD fraction → percent (×100), then strip trailing zeros (e.g. 0.000100% → 0.0001%).
  const raw = formatUnits(penaltyWad * BigInt(100), 18);
  const trimmed = raw.includes('.')
    ? raw.replace(/\.?0+$/, '')
    : raw;
  return `${trimmed || '0'}%`;
}

/** Penalty asset amount: full asset precision, trailing zeros stripped (never round dust to "0"). */
export function formatForcePenaltyAmount(
  value: bigint,
  decimals: number,
  symbol: string
): string {
  if (value <= BigInt(0)) return `0 ${symbol}`;
  const raw = formatUnits(value, decimals);
  const trimmed = raw.includes('.') ? raw.replace(/\.?0+$/, '') : raw;
  const [intPart, frac = ''] = (trimmed || '0').split('.');
  const intFormatted = Number(intPart).toLocaleString('en-US');
  if (!frac) return `${intFormatted} ${symbol}`;
  return `${intFormatted}.${frac} ${symbol}`;
}

type AdapterLiquiditySlot = {
  adapter: Address;
  data: Hex;
  available: bigint;
  penaltyWad: bigint;
};

async function loadVaultErc4626AdapterSlot(
  publicClient: PublicClient,
  adapter: Address,
  penaltyWad: bigint
): Promise<AdapterLiquiditySlot | null> {
  try {
    const innerVault = getAddress(
      await publicClient.readContract({
        address: adapter,
        abi: VAULT_ERC4626_ADAPTER_ABI,
        functionName: 'morphoVaultV1',
      })
    );
    const realAssets = (await publicClient.readContract({
      address: adapter,
      abi: VAULT_ERC4626_ADAPTER_ABI,
      functionName: 'realAssets',
    })) as bigint;
    if (realAssets <= BigInt(0)) return null;

    let withdrawable = BigInt(0);
    try {
      withdrawable = (await publicClient.readContract({
        address: innerVault,
        abi: INNER_VAULT_LIQUIDITY_ABI,
        functionName: 'maxWithdraw',
        args: [adapter],
      })) as bigint;
    } catch {
      withdrawable = BigInt(0);
    }

    if (withdrawable <= BigInt(0)) {
      // realAssets can exceed what the inner vault will release to the adapter today.
      // forceDeallocate on a fee wrapper calls adapter.deallocate → inner ERC-4626 withdraw.
      return null;
    }

    const available = minBigInt(realAssets, withdrawable);
    if (available <= BigInt(0)) return null;

    return { adapter, data: '0x', available, penaltyWad };
  } catch {
    return null;
  }
}

async function loadAdapterLiquiditySlots(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<AdapterLiquiditySlot[]> {
  const adaptersLength = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_V2_FORCE_ABI,
    functionName: 'adaptersLength',
  });

  if (adaptersLength === BigInt(0)) {
    throw new Error('This vault has no adapters to force-deallocate from.');
  }

  const slots: AdapterLiquiditySlot[] = [];

  for (let i = BigInt(0); i < adaptersLength; i = i + BigInt(1)) {
    const adapter = getAddress(
      await publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_V2_FORCE_ABI,
        functionName: 'adapters',
        args: [i],
      })
    );

    const penaltyWad = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'forceDeallocatePenalty',
      args: [adapter],
    });

    let morpho: Address;
    let marketIdsLength: bigint;
    try {
      morpho = getAddress(
        await publicClient.readContract({
          address: adapter,
          abi: ADAPTER_ABI,
          functionName: 'morpho',
        })
      );
      marketIdsLength = await publicClient.readContract({
        address: adapter,
        abi: ADAPTER_ABI,
        functionName: 'marketIdsLength',
      });
    } catch {
      const vaultSlot = await loadVaultErc4626AdapterSlot(publicClient, adapter, penaltyWad);
      if (vaultSlot) {
        slots.push(vaultSlot);
      } else {
        logger.warn('Skipping adapter with no force-withdraw liquidity path', {
          vaultAddress,
          adapter,
        });
      }
      continue;
    }

    for (let j = BigInt(0); j < marketIdsLength; j = j + BigInt(1)) {
      const marketId = await publicClient.readContract({
        address: adapter,
        abi: ADAPTER_ABI,
        functionName: 'marketIds',
        args: [j],
      });

      const expected = await publicClient.readContract({
        address: adapter,
        abi: ADAPTER_ABI,
        functionName: 'expectedSupplyAssets',
        args: [marketId],
      });

      if (expected === BigInt(0)) continue;

      const paramsTuple = await publicClient.readContract({
        address: morpho,
        abi: MORPHO_BLUE_ABI,
        functionName: 'idToMarketParams',
        args: [marketId],
      });

      const market = await publicClient.readContract({
        address: morpho,
        abi: MORPHO_BLUE_ABI,
        functionName: 'market',
        args: [marketId],
      });

      const totalSupplyAssets = BigInt(market[0]);
      const totalBorrowAssets = BigInt(market[2]);
      const cash =
        totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : BigInt(0);
      const available = minBigInt(expected, cash);
      if (available === BigInt(0)) continue;

      slots.push({
        adapter,
        data: encodeMarketParamsData({
          loanToken: getAddress(paramsTuple[0]),
          collateralToken: getAddress(paramsTuple[1]),
          oracle: getAddress(paramsTuple[2]),
          irm: getAddress(paramsTuple[3]),
          lltv: paramsTuple[4],
        }),
        available,
        penaltyWad,
      });
    }
  }

  // Prefer lower penalty first, then deepest liquidity.
  slots.sort((a, b) => {
    if (a.penaltyWad !== b.penaltyWad) {
      return a.penaltyWad < b.penaltyWad ? -1 : 1;
    }
    return a.available === b.available ? 0 : a.available > b.available ? -1 : 1;
  });
  return slots;
}

function buildMulticallArgs(
  deallocations: ForceDeallocationStep[],
  onBehalf: Address,
  exit:
    | { mode: 'withdraw'; assets: bigint }
    | { mode: 'redeem'; shares: bigint }
): Hex[] {
  const calls: Hex[] = deallocations.map((step) =>
    encodeFunctionData({
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'forceDeallocate',
      args: [
        step.adapter,
        step.data,
        step.amount,
        onBehalf,
      ],
    })
  );

  if (exit.mode === 'redeem') {
    calls.push(
      encodeFunctionData({
        abi: VAULT_V2_FORCE_ABI,
        functionName: 'redeem',
        args: [exit.shares, onBehalf, onBehalf],
      })
    );
  } else {
    calls.push(
      encodeFunctionData({
        abi: VAULT_V2_FORCE_ABI,
        functionName: 'withdraw',
        args: [exit.assets, onBehalf, onBehalf],
      })
    );
  }

  return calls;
}

/**
 * Plan a force withdraw: deallocate the illiquid shortfall into idle, then withdraw or redeem.
 * Penalty burns shares (does not reduce withdrawn assets). Prefers lower-penalty markets first.
 * Returns null when force exit cannot cover the shortfall from liquid markets.
 *
 * @param options.useRedeemExit — MAX exits: redeem remaining shares after forceDeallocate (avoids dust).
 */
export async function planForceWithdrawV2(
  publicClient: PublicClient,
  vaultAddress: Address,
  requestedAssets: bigint,
  instantLiquidityAssets: bigint,
  onBehalf: Address,
  options?: { useRedeemExit?: boolean }
): Promise<ForceWithdrawPlan | null> {
  if (requestedAssets <= BigInt(0)) return null;

  const normalizedVault = getAddress(vaultAddress);
  const user = getAddress(onBehalf);
  const useRedeemExit = options?.useRedeemExit === true;

  const instantPart = minBigInt(requestedAssets, instantLiquidityAssets);
  const shortfall = requestedAssets - instantPart;

  if (shortfall === BigInt(0)) {
    return null;
  }

  const slots = await loadAdapterLiquiditySlots(publicClient, normalizedVault);
  if (slots.length === 0) {
    logger.warn('No force-deallocatable adapter liquidity found', { vaultAddress: normalizedVault });
    return null;
  }

  // Free the full illiquid shortfall into idle. Penalty burns shares (not withdraw assets);
  // size liquidity 1:1 with shortfall. Prefer low-penalty slots (already sorted).
  const assetsToDeallocate = shortfall;
  let remaining = assetsToDeallocate;
  const deallocations: ForceDeallocationStep[] = [];
  let estimatedPenaltyAssets = BigInt(0);
  let maxPenaltyWad = BigInt(0);

  for (const slot of slots) {
    if (remaining === BigInt(0)) break;
    const amount = minBigInt(remaining, slot.available);
    if (amount === BigInt(0)) continue;

    const penaltyAssets = mulDivUp(amount, slot.penaltyWad, FORCE_DEALLOCATE_WAD);
    deallocations.push({
      adapter: slot.adapter,
      data: slot.data,
      amount,
      penaltyWad: slot.penaltyWad,
      penaltyAssets,
    });
    estimatedPenaltyAssets += penaltyAssets;
    if (slot.penaltyWad > maxPenaltyWad) maxPenaltyWad = slot.penaltyWad;
    remaining -= amount;
  }

  if (remaining > BigInt(0)) {
    logger.warn('Insufficient adapter liquidity for force withdraw shortfall', {
      vaultAddress: normalizedVault,
      remaining: remaining.toString(),
      assetsToDeallocate: assetsToDeallocate.toString(),
    });
    return null;
  }

  // User receives the requested amount; penalty is paid in shares.
  const expectedAssetsOut = requestedAssets;
  if (expectedAssetsOut === BigInt(0)) return null;

  let exitMode: 'withdraw' | 'redeem' = 'withdraw';
  let multicallArgs: Hex[];

  if (useRedeemExit) {
    const userShares = (await publicClient.readContract({
      address: normalizedVault,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'balanceOf',
      args: [user],
    })) as bigint;

    // Each forceDeallocate burns previewWithdraw(penaltyAssets) shares mid-multicall.
    let penaltyShares = BigInt(0);
    for (const step of deallocations) {
      if (step.penaltyAssets === BigInt(0)) continue;
      const sharesForPenalty = (await publicClient.readContract({
        address: normalizedVault,
        abi: VAULT_V2_FORCE_ABI,
        functionName: 'previewWithdraw',
        args: [step.penaltyAssets],
      })) as bigint;
      penaltyShares += sharesForPenalty;
    }

    if (penaltyShares >= userShares) {
      logger.warn('Force redeem exit would burn all shares as penalty; falling back to withdraw', {
        vaultAddress: normalizedVault,
        userShares: userShares.toString(),
        penaltyShares: penaltyShares.toString(),
      });
      multicallArgs = buildMulticallArgs(deallocations, user, {
        mode: 'withdraw',
        assets: expectedAssetsOut,
      });
    } else {
      const redeemShares = userShares - penaltyShares;
      const redeemArgs = buildMulticallArgs(deallocations, user, {
        mode: 'redeem',
        shares: redeemShares,
      });
      // Prefer redeem when simulation succeeds; otherwise fall back to withdraw.
      const redeemOk = await (async () => {
        try {
          await publicClient.simulateContract({
            address: normalizedVault,
            abi: VAULT_V2_FORCE_ABI,
            functionName: 'multicall',
            args: [redeemArgs],
            account: user,
          });
          return true;
        } catch {
          return false;
        }
      })();

      if (redeemOk) {
        exitMode = 'redeem';
        multicallArgs = redeemArgs;
      } else {
        logger.warn('Force redeem simulation failed; falling back to withdraw exit', {
          vaultAddress: normalizedVault,
        });
        multicallArgs = buildMulticallArgs(deallocations, user, {
          mode: 'withdraw',
          assets: expectedAssetsOut,
        });
      }
    }
  } else {
    multicallArgs = buildMulticallArgs(deallocations, user, {
      mode: 'withdraw',
      assets: expectedAssetsOut,
    });
  }

  return {
    vaultAddress: normalizedVault,
    requestedAssets,
    instantLiquidityAssets,
    assetsToDeallocate,
    expectedAssetsOut,
    estimatedPenaltyAssets,
    maxPenaltyWad,
    deallocations,
    exitMode,
    multicallArgs,
  };
}

/** Simulate vault.multicall force withdraw; returns true when it would succeed. */
export async function simulateForceWithdrawPlan(
  publicClient: PublicClient,
  plan: ForceWithdrawPlan,
  account: Address
): Promise<boolean> {
  try {
    await publicClient.simulateContract({
      address: plan.vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'multicall',
      args: [plan.multicallArgs],
      account: getAddress(account),
    });
    return true;
  } catch (err) {
    logger.warn('Force withdraw simulation failed', {
      vaultAddress: plan.vaultAddress,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export { VAULT_V2_FORCE_ABI };
