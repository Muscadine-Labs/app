import { getAddress, zeroAddress, type Address, type PublicClient } from 'viem';
import { GENERAL_ADAPTER_ADDRESS } from '@/lib/constants';
import { allowsNativeEthVaultDeposit } from '@/lib/vault-access';
import type { VaultDefinition } from '@/lib/vaults';

/**
 * Vault V2 deposit gates. `enter` requires `canReceiveShares(onBehalf)` and
 * `canSendAssets(msg.sender)`; both return true when the gate is unset.
 */
export const VAULT_GATE_ABI = [
  {
    type: 'function',
    name: 'sendAssetsGate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'receiveSharesGate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'liquidityAdapter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'canSendAssets',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'canReceiveShares',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const MORPHO_VAULT_V1_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'morphoVaultV1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/** `null` means the read failed; callers pick a safe default. */
export type GateCheck = boolean | null;

export interface VaultGateStatus {
  /** Neither deposit gate is set, so any wallet can deposit. */
  open: GateCheck;
  /** GeneralAdapter1 can send assets (Bundler3 ETH wrap deposit). */
  bundlerCanDeposit: GateCheck;
  /** Wrapper only: its liquidity adapter can still deposit into the child vault. */
  adapterCanDeposit: GateCheck;
}

type MulticallItem =
  | { status: 'success'; result: unknown }
  | { status: 'failure'; error: Error };

function asBool(item: MulticallItem | undefined): GateCheck {
  return item?.status === 'success' && typeof item.result === 'boolean'
    ? item.result
    : null;
}

function asAddress(item: MulticallItem | undefined): Address | null {
  if (item?.status !== 'success' || typeof item.result !== 'string') return null;
  try {
    return getAddress(item.result);
  } catch {
    return null;
  }
}

function bothTrue(a: GateCheck, b: GateCheck): GateCheck {
  if (a === false || b === false) return false;
  if (a === null || b === null) return null;
  return true;
}

interface AdapterRoute {
  key: string;
  adapter: Address;
}

async function readAdapterDepositAccess(
  publicClient: PublicClient,
  routes: AdapterRoute[]
): Promise<Map<string, GateCheck>> {
  const access = new Map<string, GateCheck>();
  if (routes.length === 0) return access;

  const children = (await publicClient.multicall({
    allowFailure: true,
    contracts: routes.map((route) => ({
      address: route.adapter,
      abi: MORPHO_VAULT_V1_ADAPTER_ABI,
      functionName: 'morphoVaultV1' as const,
    })),
  })) as MulticallItem[];

  const withChild = routes.flatMap((route, i) => {
    const child = asAddress(children[i]);
    if (!child) {
      access.set(route.key, null);
      return [];
    }
    return [{ ...route, child }];
  });
  if (withChild.length === 0) return access;

  const checks = (await publicClient.multicall({
    allowFailure: true,
    contracts: withChild.flatMap((route) => [
      {
        address: route.child,
        abi: VAULT_GATE_ABI,
        functionName: 'canSendAssets' as const,
        args: [route.adapter] as const,
      },
      {
        address: route.child,
        abi: VAULT_GATE_ABI,
        functionName: 'canReceiveShares' as const,
        args: [route.adapter] as const,
      },
    ]),
  })) as MulticallItem[];

  withChild.forEach((route, i) => {
    access.set(route.key, bothTrue(asBool(checks[i * 2]), asBool(checks[i * 2 + 1])));
  });
  return access;
}

/** Wallet-independent gate state for every registry vault. */
export async function readVaultGateStatus(
  publicClient: PublicClient,
  vaults: readonly VaultDefinition[]
): Promise<Record<string, VaultGateStatus>> {
  const stride = 4;
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: vaults.flatMap((vault) => {
      const address = getAddress(vault.address);
      return [
        { address, abi: VAULT_GATE_ABI, functionName: 'sendAssetsGate' as const },
        { address, abi: VAULT_GATE_ABI, functionName: 'receiveSharesGate' as const },
        {
          address,
          abi: VAULT_GATE_ABI,
          functionName: 'canSendAssets' as const,
          args: [GENERAL_ADAPTER_ADDRESS] as const,
        },
        { address, abi: VAULT_GATE_ABI, functionName: 'liquidityAdapter' as const },
      ];
    }),
  })) as MulticallItem[];

  const status: Record<string, VaultGateStatus> = {};
  const routes: AdapterRoute[] = [];

  vaults.forEach((vault, i) => {
    const key = vault.address.toLowerCase();
    const sendAssetsGate = asAddress(results[i * stride]);
    const receiveSharesGate = asAddress(results[i * stride + 1]);
    const liquidityAdapter = asAddress(results[i * stride + 3]);

    const open =
      sendAssetsGate === null || receiveSharesGate === null
        ? null
        : sendAssetsGate === zeroAddress && receiveSharesGate === zeroAddress;

    let adapterCanDeposit: GateCheck = null;
    if (vault.kind === 'wrapper') {
      if (liquidityAdapter === zeroAddress) {
        adapterCanDeposit = true;
      } else if (liquidityAdapter) {
        routes.push({ key, adapter: liquidityAdapter });
      }
    }

    status[key] = {
      open,
      bundlerCanDeposit: asBool(results[i * stride + 2]),
      adapterCanDeposit,
    };
  });

  try {
    const adapterAccess = await readAdapterDepositAccess(publicClient, routes);
    for (const [key, canDeposit] of adapterAccess) {
      status[key].adapterCanDeposit = canDeposit;
    }
  } catch {
    // Adapter checks stay unknown; deposits are not blocked on a failed read.
  }

  return status;
}

/** Per-vault result of `canSendAssets(wallet) && canReceiveShares(wallet)`. */
export async function readWalletDepositAccess(
  publicClient: PublicClient,
  vaults: readonly VaultDefinition[],
  wallet: Address
): Promise<Record<string, GateCheck>> {
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: vaults.flatMap((vault) => {
      const address = getAddress(vault.address);
      return [
        {
          address,
          abi: VAULT_GATE_ABI,
          functionName: 'canSendAssets' as const,
          args: [wallet] as const,
        },
        {
          address,
          abi: VAULT_GATE_ABI,
          functionName: 'canReceiveShares' as const,
          args: [wallet] as const,
        },
      ];
    }),
  })) as MulticallItem[];

  const access: Record<string, GateCheck> = {};
  vaults.forEach((vault, i) => {
    access[vault.address.toLowerCase()] = bothTrue(
      asBool(results[i * 2]),
      asBool(results[i * 2 + 1])
    );
  });
  return access;
}

export interface DepositEligibility {
  eligibleUnderlyingAddresses: Set<string>;
  blockedWrapperAddresses: Set<string>;
  canDepositEveryUnderlying: boolean;
  /** False only when every wrapper is blocked. */
  wrappersAcceptDeposits: boolean;
}

/**
 * Underlying: eligible only on a successful yes (wallet passes, or the vault has no gate).
 * Wrapper: blocked only on a successful no (wallet or liquidity adapter).
 */
export function resolveDepositEligibility(
  vaults: readonly VaultDefinition[],
  gates: Record<string, VaultGateStatus> | undefined,
  walletAccess: Record<string, GateCheck> | undefined
): DepositEligibility {
  const eligibleUnderlyingAddresses = new Set<string>();
  const blockedWrapperAddresses = new Set<string>();

  for (const vault of vaults) {
    const key = vault.address.toLowerCase();
    const walletAllowed = walletAccess?.[key] ?? null;
    const gate = gates?.[key];

    if (vault.kind === 'underlying') {
      if (walletAllowed === true || gate?.open === true) eligibleUnderlyingAddresses.add(key);
    } else if (walletAllowed === false || gate?.adapterCanDeposit === false) {
      blockedWrapperAddresses.add(key);
    }
  }

  const underlyings = vaults.filter((vault) => vault.kind === 'underlying');
  const wrappers = vaults.filter((vault) => vault.kind === 'wrapper');

  return {
    eligibleUnderlyingAddresses,
    blockedWrapperAddresses,
    canDepositEveryUnderlying:
      underlyings.length > 0 &&
      underlyings.every((vault) => eligibleUnderlyingAddresses.has(vault.address.toLowerCase())),
    wrappersAcceptDeposits: !(
      wrappers.length > 0 &&
      wrappers.every((vault) => blockedWrapperAddresses.has(vault.address.toLowerCase()))
    ),
  };
}

export type DepositBlocker = 'wallet' | 'adapter';

/** Query key prefix for the vault and wallet gate reads. */
export const VAULT_DEPOSIT_GATES_QUERY_KEY = ['vault-deposit-gates'] as const;

/** The send-time gate read said no; the cached gate state is stale. */
export class VaultDepositBlockedError extends Error {
  constructor(readonly blocker: DepositBlocker) {
    super(
      blocker === 'wallet'
        ? 'Deposits to this vault are limited to approved wallets. Withdrawals stay open.'
        : 'Deposits to this vault are closed right now. Withdrawals stay open.'
    );
    this.name = 'VaultDepositBlockedError';
  }
}

/**
 * Fresh read right before a deposit, so a gate change since the cached read
 * fails before any approval. Only a successful no blocks.
 */
export async function readVaultDepositBlocker(
  publicClient: PublicClient,
  vaultAddress: Address,
  wallet: Address
): Promise<DepositBlocker | null> {
  try {
    const [send, receive, adapter] = (await publicClient.multicall({
      allowFailure: true,
      contracts: [
        {
          address: vaultAddress,
          abi: VAULT_GATE_ABI,
          functionName: 'canSendAssets',
          args: [wallet],
        },
        {
          address: vaultAddress,
          abi: VAULT_GATE_ABI,
          functionName: 'canReceiveShares',
          args: [wallet],
        },
        { address: vaultAddress, abi: VAULT_GATE_ABI, functionName: 'liquidityAdapter' },
      ],
    })) as MulticallItem[];

    if (bothTrue(asBool(send), asBool(receive)) === false) return 'wallet';

    const liquidityAdapter = asAddress(adapter);
    if (!liquidityAdapter || liquidityAdapter === zeroAddress) return null;
    const access = await readAdapterDepositAccess(publicClient, [
      { key: 'vault', adapter: liquidityAdapter },
    ]);
    return access.get('vault') === false ? 'adapter' : null;
  } catch {
    return null;
  }
}

/** Bundler3 ETH wrap deposits send assets from GeneralAdapter1, so the vault gate must allow it. */
export async function readBundlerCanDeposit(
  publicClient: PublicClient,
  vaultAddress: Address
): Promise<boolean> {
  try {
    return await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_GATE_ABI,
      functionName: 'canSendAssets',
      args: [GENERAL_ADAPTER_ADDRESS],
    });
  } catch {
    return allowsNativeEthVaultDeposit(vaultAddress);
  }
}
