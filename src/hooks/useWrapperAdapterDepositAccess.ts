'use client';

import { useQuery } from '@tanstack/react-query';
import { getAddress, type Address, type PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { BASE_CHAIN_ID } from '@/lib/constants';
import {
  SEND_ASSETS_GATE_ABI,
  SEND_ASSETS_GATE_ADDRESS,
} from '@/lib/deposit-gate-config';
import { getRegistryVaultList } from '@/lib/vaults';

const WRAPPER_ADAPTER_ABI = [
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
] as const;

const VAULT_ADAPTER_ABI = [
  {
    name: 'morphoVaultV1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/**
 * True when this wrapper's single vault adapter can still deposit into its underlying.
 * A failed read throws so the caller can leave deposits enabled.
 */
async function wrapperAdapterCanDeposit(
  publicClient: PublicClient,
  wrapperAddress: Address,
  underlyingAddress: Address
): Promise<boolean> {
  const adaptersLength = await publicClient.readContract({
    address: wrapperAddress,
    abi: WRAPPER_ADAPTER_ABI,
    functionName: 'adaptersLength',
  });
  if (adaptersLength !== BigInt(1)) return false;

  const adapter = getAddress(
    await publicClient.readContract({
      address: wrapperAddress,
      abi: WRAPPER_ADAPTER_ABI,
      functionName: 'adapters',
      args: [BigInt(0)],
    })
  );
  const child = getAddress(
    await publicClient.readContract({
      address: adapter,
      abi: VAULT_ADAPTER_ABI,
      functionName: 'morphoVaultV1',
    })
  );
  if (child.toLowerCase() !== underlyingAddress.toLowerCase()) return false;

  return publicClient.readContract({
    address: SEND_ASSETS_GATE_ADDRESS,
    abi: SEND_ASSETS_GATE_ABI,
    functionName: 'canSendAssets',
    args: [adapter],
  });
}

/**
 * Wrapper deposits stay enabled until a successful read shows the adapter
 * cannot send assets into the underlying vault. A failed read does not disable deposits.
 */
export function useWrapperAdapterDepositAccess() {
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const wrappers = getRegistryVaultList().filter(
    (vault) => vault.kind === 'wrapper' && vault.underlyingAddress
  );

  const query = useQuery({
    queryKey: ['wrapper-adapter-deposit-gate', wrappers.map((vault) => vault.address)],
    enabled: Boolean(publicClient),
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      if (!publicClient) return [];
      const blocked = await Promise.all(
        wrappers.map(async (wrapper) => {
          const allowed = await wrapperAdapterCanDeposit(
            publicClient,
            getAddress(wrapper.address),
            getAddress(wrapper.underlyingAddress!)
          );
          return allowed ? null : wrapper.address.toLowerCase();
        })
      );
      return blocked.filter((address): address is string => address !== null);
    },
  });

  const blocked = new Set(query.data ?? []);
  const everyWrapperBlocked =
    query.isSuccess &&
    wrappers.length > 0 &&
    wrappers.every((wrapper) => blocked.has(wrapper.address.toLowerCase()));

  return {
    isWrapperDepositBlocked: (address: string) => blocked.has(address.toLowerCase()),
    /** False only after a successful read shows every wrapper adapter is blocked. */
    wrappersAcceptDeposits: !everyWrapperBlocked,
  };
}
