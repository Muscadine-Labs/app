import {
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';

/** Vault V2 functions a curator can submit through the timelock, plus `Submit` / `executableAt`. */
const VAULT_V2_TIMELOCK_ABI = parseAbi([
  'event Submit(bytes4 indexed selector, bytes data, uint256 executableAt)',
  'function executableAt(bytes data) view returns (uint256)',
  'function abdicate(bytes4 selector)',
  'function addAdapter(address account)',
  'function removeAdapter(address account)',
  'function increaseAbsoluteCap(bytes idData, uint256 newAbsoluteCap)',
  'function increaseRelativeCap(bytes idData, uint256 newRelativeCap)',
  'function increaseTimelock(bytes4 selector, uint256 newDuration)',
  'function decreaseTimelock(bytes4 selector, uint256 newDuration)',
  'function setIsAllocator(address account, bool newIsAllocator)',
  'function setPerformanceFee(uint256 newPerformanceFee)',
  'function setManagementFee(uint256 newManagementFee)',
  'function setPerformanceFeeRecipient(address newPerformanceFeeRecipient)',
  'function setManagementFeeRecipient(address newManagementFeeRecipient)',
  'function setForceDeallocatePenalty(address adapter, uint256 newForceDeallocatePenalty)',
  'function setAdapterRegistry(address newAdapterRegistry)',
  'function setReceiveSharesGate(address newReceiveSharesGate)',
  'function setSendSharesGate(address newSendSharesGate)',
  'function setReceiveAssetsGate(address newReceiveAssetsGate)',
  'function setSendAssetsGate(address newSendAssetsGate)',
  'function setOwner(address newOwner)',
  'function setCurator(address newCurator)',
  'function setIsSentinel(address account, bool newIsSentinel)',
  'function setName(string newName)',
  'function setSymbol(string newSymbol)',
  'function setMaxRate(uint256 newMaxRate)',
  'function setLiquidityAdapterAndData(address newLiquidityAdapter, bytes newLiquidityData)',
]);

const FUNCTION_BY_SELECTOR = new Map<string, string>(
  VAULT_V2_TIMELOCK_ABI.filter((item) => item.type === 'function').map((fn) => [
    toFunctionSelector(fn).toLowerCase(),
    fn.name,
  ])
);

/** Same shape Morpho GraphQL `pendingConfigs.items` had, so `mapVaultV2Pending` is unchanged. */
export type PendingConfigItem = {
  functionName: string;
  data: string;
  txHash: string;
  validAt: number;
  decodedData: {
    functionName?: string | null;
    cap?: string | null;
    config?: { id?: string | null; type?: string | null } | null;
    isAllocator?: boolean | null;
    managementFee?: string | null;
    performanceFee?: string | null;
    forceDeallocatePenalty?: string | null;
    timelock?: string | null;
  };
};

/** `"this"` → Adapter, `"collateralToken"` → Collateral, `"this/marketParams"` → MarketV1. */
export function capTypeFromIdData(idData: Hex): string | null {
  try {
    const [tag] = decodeAbiParameters([{ type: 'string' }], idData);
    if (tag === 'this') return 'Adapter';
    if (tag === 'collateralToken') return 'Collateral';
    if (tag === 'this/marketParams') return 'MarketV1';
  } catch {
    /* not a cap idData */
  }
  return null;
}

/** Decoded fields `mapVaultV2Pending` reads, from the submitted calldata itself. */
export function decodeSubmittedCall(
  data: Hex
): { functionName: string; decodedData: PendingConfigItem['decodedData'] } | null {
  let call: { functionName: string; args?: readonly unknown[] };
  try {
    call = decodeFunctionData({ abi: VAULT_V2_TIMELOCK_ABI, data }) as typeof call;
  } catch {
    return null;
  }
  const args = call.args ?? [];
  const str = (i: number) => (args[i] == null ? null : String(args[i]));
  switch (call.functionName) {
    case 'increaseAbsoluteCap':
    case 'increaseRelativeCap': {
      const idData = args[0] as Hex;
      return {
        functionName: call.functionName,
        decodedData: { cap: str(1), config: { id: keccak256(idData), type: capTypeFromIdData(idData) } },
      };
    }
    case 'setPerformanceFee':
      return { functionName: call.functionName, decodedData: { performanceFee: str(0) } };
    case 'setManagementFee':
      // The call takes a per-second WAD rate; the label and direction use a yearly rate.
      return {
        functionName: call.functionName,
        decodedData: { managementFee: args[0] == null ? null : (BigInt(String(args[0])) * BigInt(31_536_000)).toString() },
      };
    case 'setIsAllocator':
      return { functionName: call.functionName, decodedData: { isAllocator: Boolean(args[1]) } };
    case 'setForceDeallocatePenalty':
      return { functionName: call.functionName, decodedData: { forceDeallocatePenalty: str(1) } };
    case 'abdicate':
      return {
        functionName: call.functionName,
        decodedData: { functionName: FUNCTION_BY_SELECTOR.get(String(args[0]).toLowerCase()) ?? null },
      };
    case 'increaseTimelock':
    case 'decreaseTimelock':
      return {
        functionName: call.functionName,
        decodedData: {
          functionName: FUNCTION_BY_SELECTOR.get(String(args[0]).toLowerCase()) ?? null,
          timelock: str(1),
        },
      };
    default:
      return { functionName: call.functionName, decodedData: {} };
  }
}

function baseClient() {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return createPublicClient({
    chain: base,
    transport: http(key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : undefined),
  });
}

type RestPendingAction = { submitted_transaction_hash?: string | null };

async function fetchPendingTxHashes(vault: string, chainId: number): Promise<string[]> {
  const hashes = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://api.morpho.org/v0/vaults-v2/${chainId}:${vault}/pending-governance-actions`);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
      next: { revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS, tags: [`vault-pending-${vault}-${chainId}`] },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Morpho REST pending HTTP ${res.status}`);
    const body = (await res.json()) as { data?: RestPendingAction[]; cursor?: string | null };
    for (const action of body.data ?? []) {
      if (action.submitted_transaction_hash) hashes.add(action.submitted_transaction_hash.toLowerCase());
    }
    if (!body.cursor) return [...hashes];
    cursor = body.cursor;
  }
  throw new Error('Morpho REST pending list exceeded 20 pages');
}

/**
 * Pending timelocked changes, read from the chain. Morpho GraphQL drops
 * `pendingConfigs.data` and the decoded cap amount on 2026-12-02, and REST has
 * no raw calldata, so: REST lists the submit transactions, each receipt's
 * `Submit` events from this vault give the exact calldata, and
 * `executableAt(data)` keeps only what is still pending (0 once applied or
 * revoked). Throws on any failed read so a short list is never shown as whole.
 */
export async function fetchPendingConfigItems(
  vaultAddress: string,
  chainId: number
): Promise<PendingConfigItem[]> {
  const vault = getAddress(vaultAddress);
  const hashes = await fetchPendingTxHashes(vault, chainId);
  if (hashes.length === 0) return [];

  const client = baseClient();
  const receipts = await Promise.all(
    hashes.map((hash) => client.getTransactionReceipt({ hash: hash as Hex }))
  );
  const submits = new Map<string, { data: Hex; txHash: string }>();
  for (const receipt of receipts) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: VAULT_V2_TIMELOCK_ABI, data: log.data, topics: log.topics });
        if (event.eventName !== 'Submit') continue;
        const data = event.args.data;
        submits.set(data.toLowerCase(), { data, txHash: receipt.transactionHash });
      } catch {
        /* another event */
      }
    }
  }
  if (submits.size === 0) return [];

  const rows = [...submits.values()];
  const executableAt = await client.multicall({
    allowFailure: false,
    contracts: rows.map((row) => ({
      address: vault,
      abi: VAULT_V2_TIMELOCK_ABI,
      functionName: 'executableAt' as const,
      args: [row.data] as const,
    })),
  });

  const items: PendingConfigItem[] = [];
  rows.forEach((row, i) => {
    const validAt = Number(executableAt[i]);
    if (!(validAt > 0)) return;
    const call = decodeSubmittedCall(row.data);
    items.push({
      functionName: call?.functionName ?? row.data.slice(0, 10),
      data: row.data,
      txHash: row.txHash,
      validAt,
      decodedData: call?.decodedData ?? {},
    });
  });
  return items;
}
