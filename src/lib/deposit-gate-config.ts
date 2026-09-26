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
 * `DEPOSIT_GATE_DEPOSITOR_ALLOWLIST`, checked against `isWhitelisted` on
 * `WhitelistSendAssetsGate`. Periodically compare this list to the gate
 * (`SetIsWhitelisted` logs) and update it so they match. After any allowlist change:
 * 1. Update both files.
 * 2. Run `npm run gates:verify` in curator (RPC read). The app also reads `canSendAssets` after first paint.
 * 3. Redeploy app when config changes.
 */
export const DEPOSIT_GATE_DEPOSITOR_ADDRESSES: readonly Address[] = [
  getAddress('0x628037c2d25f5e5f6f90415cff6d7e8860f41c08'),
  getAddress('0x057fd8B961Eb664baA647a5C7A6e9728fabA266A'), // Treasury
  getAddress('0xf35B121ba32cbeaa27716abeffb6b65a55f9b333'),
  getAddress('0x31E70f063cA802DedCd76e74C8F6D730eC43D9f0'),
  getAddress('0x0d5a708b651fee1daa0470431c4262ab3e1d0261'),
  getAddress('0xa3b90423FD6f70B9f4A424dEBfB27ac502ac1464'),
  getAddress('0xf691616Dd2cF85c9cA9fa32bdFf00f5cD92BAd81'),
  getAddress('0x5b211DA4Cd92cfb9CCCFbd1De78289955EB236CD'),
  getAddress('0x8B6E43CCE1961D3671a39Fe8D9E711E69ddD74ce'),
  getAddress('0xD437c78a6bA1F42Dca908F3759ab8B8A42Af4D82'),
];

const DEPOSITOR_KEYS = new Set<string>(
  DEPOSIT_GATE_DEPOSITOR_ADDRESSES.map((row) => row.toLowerCase())
);

/** WhitelistSendAssetsGate.canSendAssets — used after the config allowlist for a live check. */
export const SEND_ASSETS_GATE_ABI = [
  {
    type: 'function',
    name: 'canSendAssets',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function isDepositorAllowlistAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  try {
    return DEPOSITOR_KEYS.has(getAddress(address).toLowerCase());
  } catch {
    return false;
  }
}
