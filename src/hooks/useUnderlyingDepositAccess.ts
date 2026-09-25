'use client';

import { useMemo } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import {
  isDepositorAllowlistAddress,
  SEND_ASSETS_GATE_ABI,
  SEND_ASSETS_GATE_ADDRESS,
} from '@/lib/deposit-gate-config';
import { getUnderlyingVaultDefinitions } from '@/lib/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';

/**
 * Underlying deposit eligibility for the connected wallet.
 *
 * The config allowlist is used immediately. When `canSendAssets` returns, that
 * on-chain result replaces it. A failed read keeps the config result.
 */
export function useUnderlyingDepositAccess() {
  const { address } = useAccount();
  const underlyings = useMemo(() => getUnderlyingVaultDefinitions(), []);

  const { data: onChainAllowed } = useReadContract({
    address: SEND_ASSETS_GATE_ADDRESS,
    abi: SEND_ASSETS_GATE_ABI,
    functionName: 'canSendAssets',
    args: address ? [address] : undefined,
    chainId: BASE_CHAIN_ID,
    query: {
      enabled: Boolean(address),
    },
  });

  const eligibleUnderlyingAddresses = useMemo(() => {
    const eligible = new Set<string>();
    const allowed =
      typeof onChainAllowed === 'boolean'
        ? onChainAllowed
        : isDepositorAllowlistAddress(address);
    if (!address || !allowed) return eligible;

    for (const vault of underlyings) {
      eligible.add(vault.address.toLowerCase());
    }
    return eligible;
  }, [address, onChainAllowed, underlyings]);

  return { eligibleUnderlyingAddresses };
}
