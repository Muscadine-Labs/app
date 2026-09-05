'use client';

import { useMemo } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { type Address, getAddress } from 'viem';
import { VAULT_V2_SEND_ASSETS_ABI } from '@/lib/abis';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { getUnderlyingVaultDefinitions } from '@/lib/vaults';
import { isEligibleToDepositToUnderlying } from '@/lib/vault-access';

const ACCESS_STALE_MS = 12_000;

export function useUnderlyingDepositAccess() {
  const { address } = useAccount();
  const underlyings = useMemo(() => getUnderlyingVaultDefinitions(), []);

  const gateContracts = useMemo(
    () =>
      underlyings.map((vault) => ({
        address: getAddress(vault.address),
        abi: VAULT_V2_SEND_ASSETS_ABI,
        functionName: 'sendAssetsGate' as const,
        chainId: BASE_CHAIN_ID,
      })),
    [underlyings]
  );

  const canSendContracts = useMemo(() => {
    if (!address) return [];
    const account = getAddress(address);
    return underlyings.map((vault) => ({
      address: getAddress(vault.address),
      abi: VAULT_V2_SEND_ASSETS_ABI,
      functionName: 'canSendAssets' as const,
      args: [account] as const,
      chainId: BASE_CHAIN_ID,
    }));
  }, [underlyings, address]);

  const { data: gateResults, isPending: gatesPending } = useReadContracts({
    allowFailure: true,
    contracts: gateContracts,
    query: { staleTime: ACCESS_STALE_MS },
  });

  const { data: canSendResults, isPending: canSendPending } = useReadContracts({
    allowFailure: true,
    contracts: canSendContracts,
    query: {
      enabled: Boolean(address) && canSendContracts.length > 0,
      staleTime: ACCESS_STALE_MS,
    },
  });

  const eligibleUnderlyingAddresses = useMemo(() => {
    const eligible = new Set<string>();
    if (!address) return eligible;

    underlyings.forEach((vault, index) => {
      const gate = gateResults?.[index]?.result;
      const canSend = canSendResults?.[index]?.result;
      if (
        isEligibleToDepositToUnderlying(
          typeof gate === 'string' ? (gate as Address) : null,
          canSend === true
        )
      ) {
        eligible.add(vault.address.toLowerCase());
      }
    });

    return eligible;
  }, [address, underlyings, gateResults, canSendResults]);

  const isLoading = Boolean(address) && (gatesPending || canSendPending);

  return {
    eligibleUnderlyingAddresses,
    isLoading,
  };
}
