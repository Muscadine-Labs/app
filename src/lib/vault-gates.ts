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

/** Per-vault: `sendAssetsGate` is unset, so any wallet can deposit. Wallet-independent. */
export async function readVaultGateStatus(
  publicClient: PublicClient,
  vaults: readonly VaultDefinition[]
): Promise<Record<string, GateCheck>> {
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: vaults.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_GATE_ABI,
      functionName: 'sendAssetsGate' as const,
    })),
  })) as MulticallItem[];

  const open: Record<string, GateCheck> = {};
  vaults.forEach((vault, i) => {
    const sendAssetsGate = asAddress(results[i]);
    open[vault.address.toLowerCase()] =
      sendAssetsGate === null ? null : sendAssetsGate === zeroAddress;
  });
  return open;
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

/**
 * Registry vault addresses (lowercase) this wallet can deposit into.
 * Eligible only on a successful yes (wallet can send assets, or the send-assets gate is unset).
 */
export function resolveDepositEligibility(
  vaults: readonly VaultDefinition[],
  gatesOpen: Record<string, GateCheck> | undefined,
  walletAccess: Record<string, GateCheck> | undefined
): Set<string> {
  const eligible = new Set<string>();
  for (const vault of vaults) {
    const key = vault.address.toLowerCase();
    if (walletAccess?.[key] === true || gatesOpen?.[key] === true) eligible.add(key);
  }
  return eligible;
}

/** Query key prefix for the vault and wallet gate reads. */
export const VAULT_DEPOSIT_GATES_QUERY_KEY = ['vault-deposit-gates'] as const;

/** The send-time gate read said no; the cached gate state is stale. */
export class VaultDepositBlockedError extends Error {
  constructor() {
    super('Deposits to this vault are limited to approved wallets. Withdrawals stay open.');
    this.name = 'VaultDepositBlockedError';
  }
}

/**
 * Fresh read right before a deposit, so a gate change since the cached read
 * fails before any approval. Only a successful no blocks.
 */
export async function isWalletDepositBlocked(
  publicClient: PublicClient,
  vaultAddress: Address,
  wallet: Address
): Promise<boolean> {
  try {
    const canSend = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_GATE_ABI,
      functionName: 'canSendAssets',
      args: [wallet],
    });
    return canSend === false;
  } catch {
    return false;
  }
}
