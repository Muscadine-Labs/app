'use client';

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { isDepositorAllowlistAddress } from '@/lib/deposit-gate-config';
import { getUnderlyingVaultDefinitions } from '@/lib/vaults';

/**
 * Underlying deposit eligibility for the connected wallet.
 *
 * Gate UI is always active (config-only allowlist). No on-chain gate RPC.
 * Ops verifies whitelist with `npm run gates:verify` in curator after config changes.
 */
export function useUnderlyingDepositAccess() {
  const { address } = useAccount();
  const underlyings = useMemo(() => getUnderlyingVaultDefinitions(), []);

  const eligibleUnderlyingAddresses = useMemo(() => {
    const eligible = new Set<string>();
    if (!address || !isDepositorAllowlistAddress(address)) return eligible;

    for (const vault of underlyings) {
      eligible.add(vault.address.toLowerCase());
    }
    return eligible;
  }, [address, underlyings]);

  return { eligibleUnderlyingAddresses };
}
