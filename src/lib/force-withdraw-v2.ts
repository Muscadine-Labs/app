/**
 * Vault V2 force-withdraw planning — Morpho SDK / exit-bundle style:
 * vault.multicall([forceDeallocate × N, withdraw]).
 *
 * Used when requested assets exceed instant liquidity (idle + liquidity adapter).
 * Ref: https://morpho-org-vault-v2.mintlify.app/operations/force-deallocate
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
  marketParams: MorphoMarketParams;
  amount: bigint;
  penaltyWad: bigint;
  penaltyAssets: bigint;
};

export type ForceWithdrawPlan = {
  vaultAddress: Address;
  requestedAssets: bigint;
  instantLiquidityAssets: bigint;
  assetsToDeallocate: bigint;
  /** Assets user should receive after penalty haircut on the illiquid shortfall. */
  expectedAssetsOut: bigint;
  /** Total penalty burned as shares (asset-equivalent), summed across steps. */
  estimatedPenaltyAssets: bigint;
  /** Max penalty rate across adapters touched (WAD). */
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

function mulDivDown(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b) / d;
}

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

type MarketLiquiditySlot = {
  adapter: Address;
  marketParams: MorphoMarketParams;
  available: bigint;
  penaltyWad: bigint;
};

async function loadMarketLiquiditySlots(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<MarketLiquiditySlot[]> {
  const adaptersLength = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_V2_FORCE_ABI,
    functionName: 'adaptersLength',
  });

  if (adaptersLength === BigInt(0)) {
    throw new Error('This vault has no adapters to force-deallocate from.');
  }

  const slots: MarketLiquiditySlot[] = [];

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
      // Non–MorphoMarketV1 adapters (e.g. vault-v1 adapters) cannot be force-planned here.
      logger.warn('Skipping adapter without Morpho market list for force withdraw', {
        vaultAddress,
        adapter,
      });
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
        marketParams: {
          loanToken: getAddress(paramsTuple[0]),
          collateralToken: getAddress(paramsTuple[1]),
          oracle: getAddress(paramsTuple[2]),
          irm: getAddress(paramsTuple[3]),
          lltv: paramsTuple[4],
        },
        available,
        penaltyWad,
      });
    }
  }

  // Prefer deepest markets first (matches exit-bundle greediness).
  slots.sort((a, b) => (a.available === b.available ? 0 : a.available > b.available ? -1 : 1));
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
        encodeMarketParamsData(step.marketParams),
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
 * Plan a force withdraw: deallocate the illiquid shortfall (penalty-adjusted), then withdraw or redeem.
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

  const slots = await loadMarketLiquiditySlots(publicClient, normalizedVault);
  if (slots.length === 0) {
    logger.warn('No force-deallocatable market liquidity found', { vaultAddress: normalizedVault });
    return null;
  }

  // Use the max penalty among candidate adapters when sizing the dealloc (conservative).
  let maxPenaltyWad = BigInt(0);
  for (const slot of slots) {
    if (slot.penaltyWad > maxPenaltyWad) maxPenaltyWad = slot.penaltyWad;
  }

  // Exit-bundle sizing: assetsToDeallocate = shortfall * WAD / (WAD + penalty)
  const assetsToDeallocate = mulDivDown(
    shortfall,
    FORCE_DEALLOCATE_WAD,
    FORCE_DEALLOCATE_WAD + maxPenaltyWad
  );

  if (assetsToDeallocate === BigInt(0)) {
    return null;
  }

  let remaining = assetsToDeallocate;
  const deallocations: ForceDeallocationStep[] = [];
  let estimatedPenaltyAssets = BigInt(0);

  for (const slot of slots) {
    if (remaining === BigInt(0)) break;
    const amount = minBigInt(remaining, slot.available);
    if (amount === BigInt(0)) continue;

    const penaltyAssets = mulDivUp(amount, slot.penaltyWad, FORCE_DEALLOCATE_WAD);
    deallocations.push({
      adapter: slot.adapter,
      marketParams: slot.marketParams,
      amount,
      penaltyWad: slot.penaltyWad,
      penaltyAssets,
    });
    estimatedPenaltyAssets += penaltyAssets;
    remaining -= amount;
  }

  if (remaining > BigInt(0)) {
    logger.warn('Insufficient market liquidity for force withdraw shortfall', {
      vaultAddress: normalizedVault,
      remaining: remaining.toString(),
      assetsToDeallocate: assetsToDeallocate.toString(),
    });
    return null;
  }

  const expectedAssetsOut = instantPart + assetsToDeallocate;
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
