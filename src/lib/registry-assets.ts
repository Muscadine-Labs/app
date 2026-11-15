import { getAddress, parseAbi, type Address, type PublicClient } from 'viem';
import { getRegistryVaultList, type VaultDefinition } from '@/lib/vaults';
import { registerTokenMetadata } from '@/lib/token-metadata';

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
}

const VAULT_ASSET_ABI = parseAbi(['function asset() view returns (address)']);
const ERC20_META_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

/** Pure: combine the vault list, each vault's `asset()` and each asset's metadata. */
export function buildRegistryAssets(
  vaults: readonly Pick<VaultDefinition, 'address'>[],
  vaultAssets: readonly string[],
  metadata: Readonly<Record<string, { symbol: string; decimals: number }>>
): RegistryAssets {
  const byVault: Record<string, RegistryAsset> = {};
  const assets: RegistryAsset[] = [];
  const seen = new Set<string>();
  vaults.forEach((vault, i) => {
    const key = vaultAssets[i]?.toLowerCase();
    const meta = key ? metadata[key] : undefined;
    if (!key || !meta) return;
    const asset: RegistryAsset = { address: getAddress(key), symbol: meta.symbol, decimals: meta.decimals };
    byVault[vault.address.toLowerCase()] = asset;
    if (!seen.has(key)) {
      seen.add(key);
      assets.push(asset);
    }
  });
  return { byVault, assets };
}

async function loadRegistryAssets(client: PublicClient): Promise<RegistryAssets> {
  const vaults = getRegistryVaultList();
  if (vaults.length === 0) return { byVault: {}, assets: [] };
  const vaultAssets = (await client.multicall({
    allowFailure: false,
    contracts: vaults.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_ASSET_ABI,
      functionName: 'asset' as const,
    })),
  })) as Address[];

  const unique = [...new Set(vaultAssets.map((a) => a.toLowerCase()))].map((a) => getAddress(a));
  const meta = (await client.multicall({
    allowFailure: false,
    contracts: unique.flatMap((address) => [
      { address, abi: ERC20_META_ABI, functionName: 'decimals' as const },
      { address, abi: ERC20_META_ABI, functionName: 'symbol' as const },
    ]),
  })) as Array<number | string>;
  const metadata: Record<string, { symbol: string; decimals: number }> = {};
  unique.forEach((address, i) => {
    metadata[address.toLowerCase()] = {
      decimals: Number(meta[i * 2]),
      symbol: String(meta[i * 2 + 1]),
    };
  });

  const result = buildRegistryAssets(vaults, vaultAssets, metadata);
  // Symbol-based formatting finds the token under its on-chain symbol and the registry label.
  vaults.forEach((vault) => {
    const asset = result.byVault[vault.address.toLowerCase()];
    if (asset) registerTokenMetadata(asset, [vault.symbol]);
  });
  return result;
}

let pending: Promise<RegistryAssets> | null = null;

/**
 * Every registry vault's asset, read once per page load (`asset()` never changes). A failed
 * read is not kept, so the next caller tries again.
 */
export function readRegistryAssets(client: PublicClient): Promise<RegistryAssets> {
  if (!pending) {
    pending = loadRegistryAssets(client).catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

/** Test helper. */
export function resetRegistryAssetsForTests(): void {
  pending = null;
}
