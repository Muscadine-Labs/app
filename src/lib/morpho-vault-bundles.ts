import type { Address } from 'viem';
import { VAULT_BUNDLES_V1_ADDRESS } from './constants';

/** Minimal ABI for Morpho's VaultBundlesV1 native-funded deposit. */
export const VAULT_BUNDLES_V1_ABI = [
  {
    type: 'function',
    name: 'vaultBundlesV1Deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'assets', type: 'uint256' },
      { name: 'maxSharePriceE27', type: 'uint256' },
      {
        name: 'assetPermit',
        type: 'tuple',
        components: [
          { name: 'kind', type: 'uint8' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'referralFeePct', type: 'uint256' },
      { name: 'referralFeeRecipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export function buildVaultBundlesNativeDeposit(options: {
  vault: Address;
  assets: bigint;
  maxSharePriceE27: bigint;
  deadline: bigint;
}) {
  return {
    address: VAULT_BUNDLES_V1_ADDRESS,
    args: [
      options.vault,
      options.assets,
      options.maxSharePriceE27,
      { kind: 0, data: '0x' },
      BigInt(0),
      '0x0000000000000000000000000000000000000000',
      options.deadline,
    ] as const,
    value: options.assets,
  };
}
