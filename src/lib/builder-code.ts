import { Attribution } from 'ox/erc8021';
import type { Hex } from 'viem';

/** Base Builder Code for ERC-8021 onchain attribution (base.dev → Builder Codes). */
const DEFAULT_BUILDER_CODE = 'bc_mwkqu9rd';

let cachedSuffix: { code: string; suffix: Hex } | undefined;

/** ERC-8021 calldata suffix appended to vault txs. Public onchain — not a secret. */
export function getBuilderDataSuffix(): Hex | undefined {
  const code =
    process.env.NEXT_PUBLIC_BASE_BUILDER_CODE?.trim() || DEFAULT_BUILDER_CODE;
  if (!code) return undefined;

  if (cachedSuffix?.code === code) return cachedSuffix.suffix;

  const suffix = Attribution.toDataSuffix({ codes: [code] });
  cachedSuffix = { code, suffix };
  return suffix;
}

/** Spread into viem `writeContract` / `simulateContract` calls. */
export function builderWriteOpts(): { dataSuffix: Hex } | Record<string, never> {
  const dataSuffix = getBuilderDataSuffix();
  return dataSuffix ? { dataSuffix } : {};
}
