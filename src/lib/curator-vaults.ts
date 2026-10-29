import { isExplorerChainId } from '@/lib/constants';
import type { VaultStrategy } from '@/lib/vaults';
import {
  createExternalVaultStub,
  getDepositedVaultAddressSet,
  isValidEthereumAddress,
  type VaultWalletFilterMode,
  type WalletMorphoPosition,
} from '@/lib/vault-utils';
import type { Vault } from '@/types/vault';

export const EXPLORER_CURATOR_OPTIONS = [
  { value: 'muscadine', label: 'Muscadine' },
  { value: 'gauntlet', label: 'Gauntlet' },
  { value: 'bitwise', label: 'Bitwise' },
  { value: 'steakhouse-financial', label: 'Steakhouse Financial' },
] as const;

export type NamedVaultCurator = (typeof EXPLORER_CURATOR_OPTIONS)[number]['value'];
/** `all` lists every curator on the selected network. */
export type VaultCuratorFilter = 'all' | NamedVaultCurator;

/** Partner curators loaded from the pinned catalog. Muscadine uses the local registry. */
export type RemoteCuratorFilter = Exclude<NamedVaultCurator, 'muscadine'>;

const REMOTE_CURATORS: readonly RemoteCuratorFilter[] = EXPLORER_CURATOR_OPTIONS.flatMap(
  (option) => (option.value === 'muscadine' ? [] : [option.value])
);

export function isRemoteCurator(value: string): value is RemoteCuratorFilter {
  return REMOTE_CURATORS.some((curator) => curator === value);
}

export function curatorLabel(curator: RemoteCuratorFilter): string {
  const option = EXPLORER_CURATOR_OPTIONS.find((entry) => entry.value === curator);
  return option?.label ?? curator;
}

/** Prime or Frontier when the vault name says so. Anything else has no strategy. */
export function strategyFromVaultName(name: string): VaultStrategy | undefined {
  const frontier = /\bfrontier\b/i.test(name);
  const prime = /\bprime\b/i.test(name);
  if (frontier === prime) return undefined;
  return frontier ? 'frontier' : 'prime';
}

export interface CuratorAddress {
  address?: string | null;
  chainId?: number | null;
}

/**
 * Curator addresses Morpho attaches to a verified curator, limited to explorer chains.
 * The same address on more than one chain is kept once; vault queries also filter by chain.
 */
export function explorerCuratorAddresses(
  addresses: readonly (CuratorAddress | null)[] | null | undefined
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of addresses ?? []) {
    const address = entry?.address ?? '';
    if (!isValidEthereumAddress(address) || !isExplorerChainId(entry?.chainId)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result;
}

/** One listed Morpho Vault V2 row. `type` is MorphoVault, not a fee wrapper. */
export interface ListedVaultV2 {
  address?: string | null;
  name?: string | null;
  symbol?: string | null;
  type?: string | null;
  totalAssetsUsd?: number | null;
  chain?: { id?: number | null } | null;
  asset?: { symbol?: string | null } | null;
  curators?: {
    items?: Array<{ id?: string | null; name?: string | null } | null> | null;
  } | null;
}

function dedupeVaultsByChain(vaults: Vault[]): Vault[] {
  const seen = new Set<string>();
  const result: Vault[] = [];
  for (const vault of vaults) {
    const key = `${vault.chainId}:${vault.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(vault);
  }
  return result;
}

/** Listed Vault V2s whose Morpho curator id matches, on an explorer chain. */
export function toCuratorExplorerVaults(
  items: readonly ListedVaultV2[],
  curator: RemoteCuratorFilter
): Vault[] {
  const curatorName = curatorLabel(curator);
  const vaults = items.flatMap((item) => {
    if (item.type && item.type !== 'MorphoVault') return [];
    const chainId = item.chain?.id;
    if (!isExplorerChainId(chainId)) return [];
    const address = item.address ?? '';
    if (!isValidEthereumAddress(address)) return [];
    const matches = item.curators?.items?.some((entry) => entry?.id === curator) ?? false;
    if (!matches) return [];

    const name = item.name?.trim() || undefined;
    const stub = createExternalVaultStub(address, {
      name,
      symbol: item.asset?.symbol?.trim() || undefined,
      chainId,
    });
    const totalAssetsUsd =
      typeof item.totalAssetsUsd === 'number' && Number.isFinite(item.totalAssetsUsd)
        ? item.totalAssetsUsd
        : undefined;

    return [
      {
        ...stub,
        vaultSymbol: item.symbol?.trim() || undefined,
        strategy: name ? strategyFromVaultName(name) : undefined,
        curator: curatorName,
        totalValueLocked: totalAssetsUsd,
        totalDeposits: totalAssetsUsd,
      },
    ];
  });

  return dedupeVaultsByChain(vaults).sort(
    (a, b) =>
      (b.totalValueLocked ?? 0) - (a.totalValueLocked ?? 0) || a.name.localeCompare(b.name)
  );
}

/** Curator catalog, narrowed to deposits when the wallet filter asks for that. */
export function curatorVaultCandidates(
  vaults: Vault[],
  positions: WalletMorphoPosition[],
  walletFilter: VaultWalletFilterMode
): Vault[] {
  if (walletFilter !== 'inWallet') return vaults;
  const deposited = getDepositedVaultAddressSet(positions);
  return vaults.filter((vault) => deposited.has(vault.address.toLowerCase()));
}
