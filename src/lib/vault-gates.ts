import { getAddress, zeroAddress, type Address, type PublicClient } from 'viem';
import type { VaultDefinition } from '@/lib/vaults';

/**
 * Vault V2 send-assets gate. `enter` also calls `canReceiveShares(onBehalf)`,
 * which is abated on every registry vault, so the app does not read it.
 * `canSendAssets` returns true when `sendAssetsGate` is unset.
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
    name: 'canSendAssets',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** `null` means the read failed; callers pick a safe default. */
export type GateCheck = boolean | null;

export interface VaultGateStatus {
  /** `sendAssetsGate` is unset, so any wallet can deposit. */
  open: GateCheck;
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

/** Wallet-independent gate state for every registry vault. */
export async function readVaultGateStatus(
  publicClient: PublicClient,
  vaults: readonly VaultDefinition[]
): Promise<Record<string, VaultGateStatus>> {
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: vaults.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_GATE_ABI,
      functionName: 'sendAssetsGate' as const,
    })),
  })) as MulticallItem[];

  const status: Record<string, VaultGateStatus> = {};
  vaults.forEach((vault, i) => {
    const sendAssetsGate = asAddress(results[i]);
    status[vault.address.toLowerCase()] = {
      open: sendAssetsGate === null ? null : sendAssetsGate === zeroAddress,
    };
  });
  return status;
}

/** Per-vault result of `canSendAssets(wallet)`. */
export async function readWalletDepositAccess(
  publicClient: PublicClient,
  vaults: readonly VaultDefinition[],
  wallet: Address
): Promise<Record<string, GateCheck>> {
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: vaults.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_GATE_ABI,
      functionName: 'canSendAssets' as const,
      args: [wallet] as const,
    })),
  })) as MulticallItem[];

  const access: Record<string, GateCheck> = {};
  vaults.forEach((vault, i) => {
    access[vault.address.toLowerCase()] = asBool(results[i]);
  });
  return access;
}

export interface DepositEligibility {
  eligibleVaultAddresses: Set<string>;
}

/**
 * Eligible only on a successful yes (wallet can send assets, or the send-assets gate is unset).
 */
export function resolveDepositEligibility(
  vaults: readonly VaultDefinition[],
  gates: Record<string, VaultGateStatus> | undefined,
  walletAccess: Record<string, GateCheck> | undefined
): DepositEligibility {
  const eligibleVaultAddresses = new Set<string>();

  for (const vault of vaults) {
    const key = vault.address.toLowerCase();
    const walletAllowed = walletAccess?.[key] ?? null;
    const gate = gates?.[key];
    if (walletAllowed === true || gate?.open === true) eligibleVaultAddresses.add(key);
  }

  return {
    eligibleVaultAddresses,
  };
}

export type DepositBlocker = 'wallet';

/** Query key prefix for the vault and wallet gate reads. */
export const VAULT_DEPOSIT_GATES_QUERY_KEY = ['vault-deposit-gates'] as const;

/** The send-time gate read said no; the cached gate state is stale. */
export class VaultDepositBlockedError extends Error {
  constructor(readonly blocker: DepositBlocker) {
    super('Deposits to this vault are limited to approved wallets. Withdrawals stay open.');
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
    const [send] = (await publicClient.multicall({
      allowFailure: true,
      contracts: [
        {
          address: vaultAddress,
          abi: VAULT_GATE_ABI,
          functionName: 'canSendAssets',
          args: [wallet],
        },
      ],
    })) as MulticallItem[];

    if (asBool(send) === false) return 'wallet';
    return null;
  } catch {
    return null;
  }
}

