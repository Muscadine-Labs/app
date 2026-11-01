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

/**
 * Per-vault `sendAssetsGate` address (`zeroAddress` = unset, any wallet can deposit).
 * `null` means the read failed. Wallet-independent.
 */
export async function readVaultSendAssetsGates(
  publicClient: PublicClient,
  vaults: readonly VaultDefinition[]
): Promise<Record<string, Address | null>> {
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: vaults.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_GATE_ABI,
      functionName: 'sendAssetsGate' as const,
    })),
  })) as MulticallItem[];

  const gates: Record<string, Address | null> = {};
  vaults.forEach((vault, i) => {
    gates[vault.address.toLowerCase()] = asAddress(results[i]);
  });
  return gates;
}

/** Per-vault: the send-assets gate is unset, so any wallet can deposit. */
export function gatesOpenFrom(
  gates: Record<string, Address | null> | undefined
): Record<string, GateCheck> | undefined {
  if (!gates) return undefined;
  const open: Record<string, GateCheck> = {};
  for (const [key, gate] of Object.entries(gates)) {
    open[key] = gate === null ? null : gate === zeroAddress;
  }
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

/**
 * Registry vault addresses (lowercase) a successful read says this wallet cannot deposit into:
 * the send-assets gate is set and the wallet does not pass it (or no wallet is connected).
 * A failed read is never counted as blocked.
 */
export function resolveDepositBlocked(
  vaults: readonly VaultDefinition[],
  gatesOpen: Record<string, GateCheck> | undefined,
  walletAccess: Record<string, GateCheck> | undefined,
  hasWallet: boolean
): Set<string> {
  const blocked = new Set<string>();
  for (const vault of vaults) {
    const key = vault.address.toLowerCase();
    if (gatesOpen?.[key] !== false) continue;
    if (hasWallet ? walletAccess?.[key] === false : true) blocked.add(key);
  }
  return blocked;
}

export const ACCESS_REQUEST_EMAIL = 'muscadinelabs@gmail.com';

/** Shown when the send-assets gate says this wallet cannot deposit. */
export const DEPOSIT_GATE_MESSAGE = `This wallet is not whitelisted to deposit into this vault. Request access by emailing ${ACCESS_REQUEST_EMAIL}. Withdrawals stay open.`;

/** Query key prefix for the vault and wallet gate reads. */
export const VAULT_DEPOSIT_GATES_QUERY_KEY = ['vault-deposit-gates'] as const;

/** The send-time gate read said no; the cached gate state is stale. */
export class VaultDepositBlockedError extends Error {
  constructor() {
    super(DEPOSIT_GATE_MESSAGE);
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
