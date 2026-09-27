'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { allowsNativeEthVaultDeposit } from '@/lib/vault-access';
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
 * Deposit access read from each vault's own gates on Base.
 *
 * Underlying deposits open only after a successful read says yes (vault has no
 * gate, or the wallet passes it). Wrapper deposits stay open unless a
 * successful read says the wallet or the wrapper's liquidity adapter is blocked.
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

  const {
    eligibleUnderlyingAddresses,
    blockedWrapperAddresses,
    canDepositEveryUnderlying,
    wrappersAcceptDeposits,
  } = useMemo(
    () => resolveDepositEligibility(REGISTRY_VAULTS, gates, walletAccess),
    [gates, walletAccess]
  );

  const isWrapperDepositBlocked = useCallback(
    (vaultAddress: string) => blockedWrapperAddresses.has(vaultAddress.toLowerCase()),
    [blockedWrapperAddresses]
  );

  const allowsNativeEthDeposit = useCallback(
    (vaultAddress: string) =>
      gates?.[vaultAddress.toLowerCase()]?.bundlerCanDeposit ??
      allowsNativeEthVaultDeposit(vaultAddress),
    [gates]
  );

  return {
    eligibleUnderlyingAddresses,
    isWrapperDepositBlocked,
    allowsNativeEthDeposit,
    canDepositEveryUnderlying,
    wrappersAcceptDeposits,
    isResolving: vaultQuery.isLoading || (Boolean(address) && walletQuery.isLoading),
  };
}
