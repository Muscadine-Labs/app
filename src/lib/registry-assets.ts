import { getAddress, hexToString, parseAbi, type Address, type PublicClient } from 'viem';
import { BASE_WETH_ADDRESS } from '@/lib/constants';
import { getRegistryVaultList, type VaultDefinition } from '@/lib/vaults';
import { registerTokenMetadata } from '@/lib/token-metadata';
import { logger } from '@/lib/logger';

/** The asset a registry vault takes and pays, read from the vault itself. */
export interface RegistryAsset {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface RegistryAssets {
  /** Lowercase vault address → its asset. */
  byVault: Record<string, RegistryAsset>;
  /** Each distinct asset once, in registry order. */
  assets: RegistryAsset[];
  /** False when some vault's asset could not be read (or this is the built-in fallback). */
  complete: boolean;
}

const VAULT_ASSET_ABI = parseAbi(['function asset() view returns (address)']);
const ERC20_META_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
/** Older tokens (e.g. MKR-style) return `symbol()` as bytes32. */
const ERC20_SYMBOL_BYTES32_ABI = parseAbi(['function symbol() view returns (bytes32)']);

/**
 * Well-known Base tokens, used only when the on-chain asset read fails so the app still prices
 * and reads balances for the common vault assets (the behaviour before tokens were dynamic).
 */
const KNOWN_BASE_TOKENS: readonly RegistryAsset[] = [
  { address: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), symbol: 'USDC', decimals: 6 },
  { address: getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'), symbol: 'cbBTC', decimals: 8 },
  { address: getAddress(BASE_WETH_ADDRESS), symbol: 'WETH', decimals: 18 },
];

/** Pure: combine the vault list, each vault's `asset()` and each asset's metadata. */
export function buildRegistryAssets(
  vaults: readonly Pick<VaultDefinition, 'address'>[],
  vaultAssets: readonly (string | null | undefined)[],
  metadata: Readonly<Record<string, { symbol: string; decimals: number }>>
): RegistryAssets {
  const byVault: Record<string, RegistryAsset> = {};
  const assets: RegistryAsset[] = [];
  const seen = new Set<string>();
  let complete = true;
  vaults.forEach((vault, i) => {
    const key = vaultAssets[i]?.toLowerCase();
    const meta = key ? metadata[key] : undefined;
    if (!key || !meta) {
      complete = false;
      return;
    }
    const asset: RegistryAsset = { address: getAddress(key), symbol: meta.symbol, decimals: meta.decimals };
    byVault[vault.address.toLowerCase()] = asset;
    if (!seen.has(key)) {
      seen.add(key);
      assets.push(asset);
    }
  });
  return { byVault, assets, complete };
}

/**
 * Pure: the registry vaults whose `symbol` label names a well-known Base token, mapped to it.
 * Used while (or when) the on-chain read fails.
 */
export function fallbackRegistryAssets(
  vaults: readonly Pick<VaultDefinition, 'address' | 'symbol'>[] = getRegistryVaultList()
): RegistryAssets {
  const byVault: Record<string, RegistryAsset> = {};
  const used = new Set<string>();
  for (const vault of vaults) {
    const known = KNOWN_BASE_TOKENS.find((t) => t.symbol.toUpperCase() === vault.symbol.toUpperCase());
    if (!known) continue;
    byVault[vault.address.toLowerCase()] = known;
    used.add(known.address.toLowerCase());
  }
  // WETH stays in the list: native ETH is priced with it.
  const assets = KNOWN_BASE_TOKENS.filter(
    (t) => used.has(t.address.toLowerCase()) || t.symbol === 'WETH'
  );
  return { byVault, assets, complete: false };
}

/**
 * A read that missed some vaults keeps what it got and fills the rest from the known Base
 * tokens, so a vault never drops out of balances or prices because one call failed.
 */
export function withFallbackAssets(
  read: RegistryAssets | null | undefined,
  fallback: RegistryAssets = fallbackRegistryAssets()
): RegistryAssets {
  if (!read) return fallback;
  if (read.complete) return read;
  const byVault = { ...fallback.byVault, ...read.byVault };
  const seen = new Set(read.assets.map((a) => a.address.toLowerCase()));
  const assets = [...read.assets, ...fallback.assets.filter((a) => !seen.has(a.address.toLowerCase()))];
  return { byVault, assets, complete: false };
}

function decodeSymbol(result: { status: string; result?: unknown } | undefined): string | null {
  if (result?.status !== 'success') return null;
  const value = result.result;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function loadRegistryAssets(client: PublicClient): Promise<RegistryAssets> {
  const vaults = getRegistryVaultList();
  if (vaults.length === 0) return { byVault: {}, assets: [], complete: true };
  // One unreadable vault must not hide every other vault's asset.
  const assetResults = await client.multicall({
    allowFailure: true,
    contracts: vaults.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_ASSET_ABI,
      functionName: 'asset' as const,
    })),
  });
  const vaultAssets = assetResults.map((r) =>
    r.status === 'success' ? (r.result as Address) : null
  );

  const unique = [...new Set(vaultAssets.filter((a): a is Address => !!a).map((a) => a.toLowerCase()))].map(
    (a) => getAddress(a)
  );
  if (unique.length === 0) throw new Error('No registry vault asset could be read');

  const meta = await client.multicall({
    allowFailure: true,
    contracts: unique.flatMap((address) => [
      { address, abi: ERC20_META_ABI, functionName: 'decimals' as const },
      { address, abi: ERC20_META_ABI, functionName: 'symbol' as const },
    ]),
  });

  const needsBytes32 = unique.filter((_, i) => decodeSymbol(meta[i * 2 + 1]) === null);
  const bytes32Symbols = needsBytes32.length
    ? await client.multicall({
        allowFailure: true,
        contracts: needsBytes32.map((address) => ({
          address,
          abi: ERC20_SYMBOL_BYTES32_ABI,
          functionName: 'symbol' as const,
        })),
      })
    : [];

  const metadata: Record<string, { symbol: string; decimals: number }> = {};
  unique.forEach((address, i) => {
    const decimals = meta[i * 2];
    // Amounts are wrong without decimals: leave the token out rather than guess.
    if (decimals?.status !== 'success') return;
    let symbol = decodeSymbol(meta[i * 2 + 1]);
    if (!symbol) {
      const raw = bytes32Symbols[needsBytes32.indexOf(address)];
      if (raw?.status === 'success') {
        symbol = hexToString(raw.result as `0x${string}`, { size: 32 }).replace(/\0/g, '').trim() || null;
      }
    }
    if (!symbol) {
      symbol = vaults.find((v, j) => vaultAssets[j]?.toLowerCase() === address.toLowerCase())?.symbol ?? 'TOKEN';
    }
    metadata[address.toLowerCase()] = { decimals: Number(decimals.result), symbol };
  });

  const result = buildRegistryAssets(vaults, vaultAssets, metadata);
  if (result.assets.length === 0) throw new Error('No registry vault asset metadata could be read');
  // Symbol-based formatting finds the token under its on-chain symbol and the registry label.
  vaults.forEach((vault) => {
    const asset = result.byVault[vault.address.toLowerCase()];
    if (!asset) return;
    if (asset.symbol.toUpperCase() !== vault.symbol.toUpperCase()) {
      // Usually a copied registry row: the label is only a fallback, the on-chain asset wins.
      logger.warn('Registry symbol differs from the vault asset', {
        vault: vault.address,
        registrySymbol: vault.symbol,
        assetSymbol: asset.symbol,
      });
    }
    registerTokenMetadata(asset, [vault.symbol]);
  });
  return result;
}

let pending: Promise<RegistryAssets> | null = null;

/**
 * Every registry vault's asset. A complete read is kept for the page's life (`asset()` never
 * changes); a failed or partial read is not, so the next caller tries again.
 */
export function readRegistryAssets(client: PublicClient): Promise<RegistryAssets> {
  if (!pending) {
    const attempt = loadRegistryAssets(client);
    pending = attempt;
    attempt.then(
      (result) => {
        if (!result.complete && pending === attempt) pending = null;
      },
      () => {
        if (pending === attempt) pending = null;
      }
    );
  }
  return pending;
}

/** Test helper. */
export function resetRegistryAssetsForTests(): void {
  pending = null;
}
