import { type Address, getAddress } from 'viem';

/** Deployed WhitelistSendAssetsGate on Base. Sync with curator `deposit-gates.ts`. */
export const SEND_ASSETS_GATE_ADDRESS = getAddress(
  process.env.NEXT_PUBLIC_SEND_ASSETS_GATE_ADDRESS?.trim() ||
    '0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9'
);

/**
 * EOA wallets allowed to deposit underlying directly (not adapters — those are on-chain only).
 *
 * Source of truth for ops: `curator/lib/config/deposit-gates.ts` →
 * `DEPOSIT_GATE_DEPOSITOR_ALLOWLIST`. After any allowlist change:
 * 1. Update both files.
 * 2. Run `npm run gates:verify` in curator (RPC read — not used by this app).
 * 3. Redeploy app when config changes.
 */
export const DEPOSIT_GATE_DEPOSITOR_ADDRESSES: readonly Address[] = [
  getAddress('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08'),
  getAddress('0x057fd8B961Eb664baA647a5C7A6e9728fabA266A'), // Treasury
  getAddress('0xf35B121ba32cbeaa27716abeffb6b65a55f9b333'),
  getAddress('0x31E70f063cA802DedCd76e74C8F6D730eC43D9f0'),
  getAddress('0x0d5a708b651fee1daa0470431c4262ab3e1d0261'),
];

const DEPOSITOR_KEYS = new Set<string>(
  DEPOSIT_GATE_DEPOSITOR_ADDRESSES.map((row) => row.toLowerCase())
);

export function isDepositorAllowlistAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  try {
    return DEPOSITOR_KEYS.has(getAddress(address).toLowerCase());
  } catch {
    return false;
  }
}
