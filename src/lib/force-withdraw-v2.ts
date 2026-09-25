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
 * Used when requested assets exceed instant liquidity (idle + liquidity adapter), read on-chain.
 * Underlying vaults: vault.multicall([forceDeallocate × N, withdraw|redeem]) on that vault.
 * Fee wrappers: one Bundler3 bundle of child forceDeallocate (0% penalty) then wrapper withdraw.
 * The liquidity route market is never force-deallocated: the final withdraw already pulls from it.
 * Do not use Vault V2 maxWithdraw — it always returns 0.
 * Ref: https://docs.morpho.org/developers/sdks/morpho-sdk/vault/#force-withdraw--force-redeem
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  keccak256,
  pad,
  parseAbiParameters,
  toHex,
} from 'viem';
import {
  buildBundlerDirectCall,
  buildErc4626RedeemCall,
  buildErc4626WithdrawCall,
  minSharePriceE27FromQuote,
  type Bundler3Call,
} from '@/lib/bundler3';
import { BUNDLER3_ADDRESS, GENERAL_ADAPTER_ADDRESS } from '@/lib/constants';
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
  /** Inner calls for vault.multicall (forceDeallocate… + withdraw|redeem). Empty when `bundlerCalls` is set. */
  multicallArgs: Hex[];
  /**
   * Wrapper exits: `C.forceDeallocate` × N then `W.withdraw` in one Bundler3 multicall.
   * The child penalty is 0, so this does not burn wrapper shares as a penalty.
   */
  bundlerCalls?: Bundler3Call[];
  /** Wrapper shares GeneralAdapter1 must be allowed to burn on erc4626 withdraw/redeem. */
  sharesToApprove?: bigint;
};

/** Request exceeds what force-deallocate can free. `reachableAssets` is the amount the UI should keep. */
export class ForceWithdrawShortfallError extends Error {
  readonly reachableAssets: bigint;

  constructor(reachableAssets: bigint) {
    super('Withdrawal exceeds force-deallocatable liquidity.');
    this.name = 'ForceWithdrawShortfallError';
    this.reachableAssets = reachableAssets;
  }
}

const VAULT_V2_FORCE_ABI = [
  {
    name: 'accrueInterest',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'accrueInterestView',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' },
    ],
  },
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
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'liquidityAdapter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'liquidityData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'previewRedeem',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
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

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** True for an on-chain revert or empty return data, false for RPC / network failures. */
function isContractRevert(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    Boolean(
      err.walk(
        (cause) =>
          cause instanceof ContractFunctionRevertedError ||
          cause instanceof ContractFunctionZeroDataError
      )
    )
  );
}

function indexRange(length: bigint): bigint[] {
  return Array.from({ length: Number(length) }, (_, i) => BigInt(i));
}

/** Blue market slots for one adapter. Adapters without Blue markets (vault adapters) return []. */
async function loadMarketAdapterSlots(
  publicClient: PublicClient,
  vaultAddress: Address,
  adapter: Address
): Promise<AdapterLiquiditySlot[]> {
  let morpho: Address;
  let marketIdsLength: bigint;
  try {
    const [morphoRaw, length] = await Promise.all([
      publicClient.readContract({
        address: adapter,
        abi: ADAPTER_ABI,
        functionName: 'morpho',
      }),
      publicClient.readContract({
        address: adapter,
        abi: ADAPTER_ABI,
        functionName: 'marketIdsLength',
      }),
    ]);
    morpho = getAddress(morphoRaw);
    marketIdsLength = length;
  } catch (err) {
    // A vault adapter reverts here. Any other failure must not look like "no liquidity".
    if (!isContractRevert(err)) throw err;
    logger.warn('Skipping adapter with no Morpho Blue markets', { vaultAddress, adapter });
    return [];
  }

  const [penaltyWad, marketIds] = await Promise.all([
    publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'forceDeallocatePenalty',
      args: [adapter],
    }),
    Promise.all(
      indexRange(marketIdsLength).map((j) =>
        publicClient.readContract({
          address: adapter,
          abi: ADAPTER_ABI,
          functionName: 'marketIds',
          args: [j],
        })
      )
    ),
  ]);

  const slots = await Promise.all(
    marketIds.map(async (marketId): Promise<AdapterLiquiditySlot | null> => {
      const [expected, paramsTuple, market] = await Promise.all([
        publicClient.readContract({
          address: adapter,
          abi: ADAPTER_ABI,
          functionName: 'expectedSupplyAssets',
          args: [marketId],
        }),
        publicClient.readContract({
          address: morpho,
          abi: MORPHO_BLUE_ABI,
          functionName: 'idToMarketParams',
          args: [marketId],
        }),
        publicClient.readContract({
          address: morpho,
          abi: MORPHO_BLUE_ABI,
          functionName: 'market',
          args: [marketId],
        }),
      ]);

      const totalSupplyAssets = BigInt(market[0]);
      const totalBorrowAssets = BigInt(market[2]);
      const cash =
        totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : BigInt(0);
      const available = minBigInt(expected, cash);
      if (available === BigInt(0)) return null;

      return {
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
      };
    })
  );

  return slots.filter((slot): slot is AdapterLiquiditySlot => slot !== null);
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

  const adapters = await Promise.all(
    indexRange(adaptersLength).map(async (i) =>
      getAddress(
        await publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_V2_FORCE_ABI,
          functionName: 'adapters',
          args: [i],
        })
      )
    )
  );

  const slots = (
    await Promise.all(
      adapters.map((adapter) => loadMarketAdapterSlots(publicClient, vaultAddress, adapter))
    )
  ).flat();

  // Prefer lower penalty first, then deepest liquidity.
  slots.sort((a, b) => {
    if (a.penaltyWad !== b.penaltyWad) {
      return a.penaltyWad < b.penaltyWad ? -1 : 1;
    }
    return a.available === b.available ? 0 : a.available > b.available ? -1 : 1;
  });
  return slots;
}

type VaultCashLiquidity = {
  idleAssets: bigint;
  /** What a plain withdraw pulls through the liquidity adapter (vault supply capped by market cash). */
  routeAssets: bigint;
  /**
   * Force-deallocatable slots, sorted. The liquidity route market is excluded: its cash is
   * already counted in `routeAssets`, and draining it first would make the final withdraw revert.
   */
  slots: AdapterLiquiditySlot[];
};

/** On-chain cash a Vault V2 with Blue market adapters can pay out. */
async function readVaultCashLiquidity(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<VaultCashLiquidity> {
  const [asset, liquidityAdapter, liquidityData, allSlots] = await Promise.all([
    publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'asset',
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'liquidityAdapter',
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'liquidityData',
    }),
    loadAdapterLiquiditySlots(publicClient, vaultAddress),
  ]);

  const idleAssets = await publicClient.readContract({
    address: getAddress(asset),
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [vaultAddress],
  });

  const routeAdapter = getAddress(liquidityAdapter);
  const routeData = liquidityData.toLowerCase();
  const isRoute = (slot: AdapterLiquiditySlot) =>
    slot.adapter === routeAdapter && slot.data.toLowerCase() === routeData;

  return {
    idleAssets,
    routeAssets: allSlots.find(isRoute)?.available ?? BigInt(0),
    slots: allSlots.filter((slot) => !isRoute(slot)),
  };
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

const BUNDLER3_SIM_ABI = [
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

/** Vault V2 allowance mapping slot (owner → spender → amount). */
const VAULT_V2_ALLOWANCE_SLOT = BigInt(13);

export type WrapperExitLiquidity = {
  idleAssets: bigint;
  /** Idle on W plus what a plain W.withdraw can pull from C (capped by the adapter position). */
  instantAssets: bigint;
  /** Extra cash reachable by force-deallocating C's other markets, still capped by the adapter position. */
  deallocatableAssets: bigint;
  totalAssets: bigint;
};

type WrapperChildLink = { adapter: Address; child: Address };

type WrapperExitState = WrapperExitLiquidity & {
  /** Zero-penalty child slots outside the child's liquidity route. */
  childSlots: AdapterLiquiditySlot[];
};

function allowanceStorageSlot(owner: Address, spender: Address): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [owner, VAULT_V2_ALLOWANCE_SLOT]
    )
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [spender, BigInt(inner)]
    )
  );
}

/**
 * Fee wrapper link: exactly one adapter that points at a child vault (`morphoVaultV1`).
 * Returns null for other vaults. RPC failures throw so a wrapper is never planned as an underlying vault.
 */
async function readWrapperChild(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<WrapperChildLink | null> {
  const adaptersLength = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_V2_FORCE_ABI,
    functionName: 'adaptersLength',
  });
  if (adaptersLength !== BigInt(1)) return null;
  const adapter = getAddress(
    await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'adapters',
      args: [BigInt(0)],
    })
  );
  try {
    const child = getAddress(
      await publicClient.readContract({
        address: adapter,
        abi: VAULT_ERC4626_ADAPTER_ABI,
        functionName: 'morphoVaultV1',
      })
    );
    return { adapter, child };
  } catch (err) {
    if (isContractRevert(err)) return null;
    throw err;
  }
}

async function readWrapperExitState(
  publicClient: PublicClient,
  wrapper: Address,
  childLink: WrapperChildLink
): Promise<WrapperExitState> {
  const [asset, realAssets, child] = await Promise.all([
    publicClient.readContract({
      address: wrapper,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'asset',
    }),
    publicClient.readContract({
      address: childLink.adapter,
      abi: VAULT_ERC4626_ADAPTER_ABI,
      functionName: 'realAssets',
    }),
    readVaultCashLiquidity(publicClient, childLink.child),
  ]);
  const idleW = await publicClient.readContract({
    address: getAddress(asset),
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [wrapper],
  });

  const childInstant = minBigInt(realAssets, child.idleAssets + child.routeAssets);
  const instantAssets = idleW + childInstant;
  const headroom = realAssets > childInstant ? realAssets - childInstant : BigInt(0);

  const childSlots = child.slots.filter((slot) => slot.penaltyWad === BigInt(0));
  const otherCash = childSlots.reduce((sum, slot) => sum + slot.available, BigInt(0));
  const deallocatableAssets = minBigInt(headroom, otherCash);

  return {
    idleAssets: idleW,
    instantAssets,
    deallocatableAssets,
    totalAssets: instantAssets + deallocatableAssets,
    childSlots,
  };
}

/**
 * On-chain exit liquidity for a fee wrapper. Instant is what `W.withdraw` can take
 * with no penalty. Deallocatable is the rest of the wrapper's child position that
 * `C.forceDeallocate` can move to idle first. Returns null when the vault is not a wrapper.
 */
export async function readWrapperExitLiquidity(
  publicClient: PublicClient,
  wrapperAddress: Address
): Promise<WrapperExitLiquidity | null> {
  const wrapper = getAddress(wrapperAddress);
  const childLink = await readWrapperChild(publicClient, wrapper);
  if (!childLink) return null;

  const state = await readWrapperExitState(publicClient, wrapper, childLink);
  return {
    idleAssets: state.idleAssets,
    instantAssets: state.instantAssets,
    deallocatableAssets: state.deallocatableAssets,
    totalAssets: state.totalAssets,
  };
}

/** Wrapper exit goes through GeneralAdapter1 so only the bundle initiator can spend the shares. */
function wrapperExitCall(
  wrapper: Address,
  user: Address,
  exit:
    | { mode: 'withdraw'; assets: bigint; shares: bigint }
    | { mode: 'redeem'; assets: bigint; shares: bigint }
): Bundler3Call {
  const minSharePriceE27 = minSharePriceE27FromQuote(exit.assets, exit.shares);
  if (exit.mode === 'redeem') {
    return buildErc4626RedeemCall(wrapper, exit.shares, user, user, minSharePriceE27);
  }
  return buildErc4626WithdrawCall(wrapper, exit.assets, user, user, minSharePriceE27);
}

/**
 * Fee wrapper: move the shortfall to idle on the child (0% penalty), then withdraw the wrapper.
 * Returns null when instant liquidity already covers the exit.
 */
async function planWrapperForceWithdraw(
  publicClient: PublicClient,
  wrapper: Address,
  childLink: WrapperChildLink,
  requestedAssets: bigint,
  onBehalf: Address,
  useRedeemExit: boolean
): Promise<ForceWithdrawPlan | null> {
  const liquidity = await readWrapperExitState(publicClient, wrapper, childLink);

  let assetsOut = requestedAssets;
  let userShares = BigInt(0);
  if (useRedeemExit) {
    userShares = (await publicClient.readContract({
      address: wrapper,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'balanceOf',
      args: [onBehalf],
    })) as bigint;
    if (userShares === BigInt(0)) throw new Error('No vault shares to redeem.');
    assetsOut = (await publicClient.readContract({
      address: wrapper,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'previewRedeem',
      args: [userShares],
    })) as bigint;
  }

  if (assetsOut <= liquidity.instantAssets) return null;
  if (assetsOut > liquidity.totalAssets) {
    throw new ForceWithdrawShortfallError(liquidity.totalAssets);
  }

  const shortfall = assetsOut - liquidity.instantAssets;
  let remaining = shortfall;
  const deallocations: ForceDeallocationStep[] = [];
  for (const slot of liquidity.childSlots) {
    if (remaining === BigInt(0)) break;
    const amount = minBigInt(remaining, slot.available);
    if (amount === BigInt(0)) continue;
    deallocations.push({
      adapter: slot.adapter,
      data: slot.data,
      amount,
      penaltyWad: BigInt(0),
      penaltyAssets: BigInt(0),
    });
    remaining -= amount;
  }

  if (remaining > BigInt(0) || deallocations.length === 0) {
    throw new ForceWithdrawShortfallError(assetsOut - remaining);
  }

  const bundlerCalls = [
    buildBundlerDirectCall(
      childLink.child,
      encodeFunctionData({ abi: VAULT_V2_FORCE_ABI, functionName: 'accrueInterest', args: [] })
    ),
    buildBundlerDirectCall(
      wrapper,
      encodeFunctionData({ abi: VAULT_V2_FORCE_ABI, functionName: 'accrueInterest', args: [] })
    ),
    ...deallocations.map((step) =>
      buildBundlerDirectCall(
        childLink.child,
        encodeFunctionData({
          abi: VAULT_V2_FORCE_ABI,
          functionName: 'forceDeallocate',
          args: [step.adapter, step.data, step.amount, onBehalf],
        })
      )
    ),
  ];

  let exitMode: 'withdraw' | 'redeem' = 'withdraw';
  let sharesToApprove = BigInt(0);
  if (useRedeemExit) {
    exitMode = 'redeem';
    sharesToApprove = userShares;
    bundlerCalls.push(
      wrapperExitCall(wrapper, onBehalf, {
        mode: 'redeem',
        assets: assetsOut,
        shares: userShares,
      })
    );
  } else {
    sharesToApprove = (await publicClient.readContract({
      address: wrapper,
      abi: VAULT_V2_FORCE_ABI,
      functionName: 'previewWithdraw',
      args: [assetsOut],
    })) as bigint;
    bundlerCalls.push(
      wrapperExitCall(wrapper, onBehalf, {
        mode: 'withdraw',
        assets: assetsOut,
        shares: sharesToApprove,
      })
    );
  }

  return {
    vaultAddress: wrapper,
    requestedAssets: assetsOut,
    instantLiquidityAssets: liquidity.instantAssets,
    assetsToDeallocate: shortfall,
    expectedAssetsOut: assetsOut,
    estimatedPenaltyAssets: BigInt(0),
    maxPenaltyWad: BigInt(0),
    deallocations,
    exitMode,
    multicallArgs: [],
    bundlerCalls,
    sharesToApprove,
  };
}

/**
 * Plan a force withdraw: deallocate the illiquid shortfall into idle, then withdraw or redeem.
 * Instant liquidity is read on-chain (idle + liquidity route). Penalty burns shares (does not
 * reduce withdrawn assets). Prefers lower-penalty markets first.
 *
 * Returns null only when instant liquidity already covers the request, so a plain withdraw works.
 * Throws `ForceWithdrawShortfallError` when markets cannot cover the shortfall.
 *
 * @param options.useRedeemExit — MAX exits: redeem remaining shares after forceDeallocate (avoids dust).
 */
export async function planForceWithdrawV2(
  publicClient: PublicClient,
  vaultAddress: Address,
  requestedAssets: bigint,
  onBehalf: Address,
  options?: { useRedeemExit?: boolean }
): Promise<ForceWithdrawPlan | null> {
  if (requestedAssets <= BigInt(0)) return null;

  const normalizedVault = getAddress(vaultAddress);
  const user = getAddress(onBehalf);
  const useRedeemExit = options?.useRedeemExit === true;

  const childLink = await readWrapperChild(publicClient, normalizedVault);
  if (childLink) {
    return planWrapperForceWithdraw(
      publicClient,
      normalizedVault,
      childLink,
      requestedAssets,
      user,
      useRedeemExit
    );
  }

  const cash = await readVaultCashLiquidity(publicClient, normalizedVault);
  const instantLiquidityAssets = cash.idleAssets + cash.routeAssets;
  if (requestedAssets <= instantLiquidityAssets) {
    return null;
  }
  const shortfall = requestedAssets - instantLiquidityAssets;

  // Free the full illiquid shortfall into idle. Penalty burns shares (not withdraw assets);
  // size liquidity 1:1 with shortfall. Prefer low-penalty slots (already sorted).
  const assetsToDeallocate = shortfall;
  let remaining = assetsToDeallocate;
  const deallocations: ForceDeallocationStep[] = [];
  let estimatedPenaltyAssets = BigInt(0);
  let maxPenaltyWad = BigInt(0);

  for (const slot of cash.slots) {
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
    throw new ForceWithdrawShortfallError(requestedAssets - remaining);
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
    if (plan.bundlerCalls && plan.bundlerCalls.length > 0) {
      const user = getAddress(account);
      const shares = plan.sharesToApprove ?? BigInt(0);
      await publicClient.simulateContract({
        address: getAddress(BUNDLER3_ADDRESS),
        abi: BUNDLER3_SIM_ABI,
        functionName: 'multicall',
        args: [plan.bundlerCalls],
        account: user,
        stateOverride:
          shares > BigInt(0)
            ? [
                {
                  address: plan.vaultAddress,
                  stateDiff: [
                    {
                      slot: allowanceStorageSlot(user, getAddress(GENERAL_ADAPTER_ADDRESS)),
                      value: pad(toHex(shares)),
                    },
                  ],
                },
              ]
            : undefined,
      });
      return true;
    }

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
