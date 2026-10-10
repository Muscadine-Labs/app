'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { BASE_CHAIN_ID } from '@/lib/constants';
import {
  VAULT_DEPOSIT_GATES_QUERY_KEY,
  readVaultGateStatus,
  readWalletDepositAccess,
  resolveDepositEligibility,
} from '@/lib/vault-gates';
import { getRegistryVaultList } from '@/lib/vaults';

const GATE_STALE_MS = 30_000;
const REGISTRY_VAULTS = getRegistryVaultList();

/**
 * Deposit access read from each vault's send-assets gate on Base.
 * Receive-shares is abated on every registry vault, so it is not read.
 *
 * Deposits open only after a successful read says yes (send-assets gate unset,
 * or the wallet passes it).
 */
export function useVaultDepositGates() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const walletKey = address?.toLowerCase() ?? null;

  const vaultQuery = useQuery({
    queryKey: VAULT_DEPOSIT_GATES_QUERY_KEY,
    enabled: Boolean(publicClient),
    staleTime: GATE_STALE_MS,
    refetchOnWindowFocus: true,
    queryFn: () => readVaultGateStatus(publicClient!, REGISTRY_VAULTS),
  });

  const walletQuery = useQuery({
    queryKey: [...VAULT_DEPOSIT_GATES_QUERY_KEY, walletKey],
    enabled: Boolean(publicClient && address),
    staleTime: GATE_STALE_MS,
    refetchOnWindowFocus: true,
    queryFn: () => readWalletDepositAccess(publicClient!, REGISTRY_VAULTS, address!),
  });

  const gates = vaultQuery.data;
  const walletAccess = walletKey ? walletQuery.data : undefined;

  const { eligibleVaultAddresses } = useMemo(
    () => resolveDepositEligibility(REGISTRY_VAULTS, gates, walletAccess),
    [gates, walletAccess]
  );

  return {
    eligibleVaultAddresses,
    isResolving: vaultQuery.isLoading || (Boolean(address) && walletQuery.isLoading),
  };
}
