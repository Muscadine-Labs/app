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
 * The config allowlist is used on the first paint. `canSendAssets` runs after
 * that. A true on-chain result can add a wallet that is not in the config.
 * A false or failed read does not remove a config allowlist, so an already
 * listed wallet does not change on screen while the read is in flight.
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
      isDepositorAllowlistAddress(address) || onChainAllowed === true;
    if (!address || !allowed) return eligible;

    for (const vault of underlyings) {
      eligible.add(vault.address.toLowerCase());
    }
    return eligible;
  }, [address, onChainAllowed, underlyings]);

  return { eligibleUnderlyingAddresses };
}
