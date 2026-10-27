import { fetchMorphoGraphQL, readMorphoGraphQLResponse } from '@/lib/api-utils';
import { MORPHO_GRAPHQL_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * A curator change waiting out its timelock. `add`: raises risk or cost (new
 * adapter, higher cap, higher fee, new allocator). `remove`: takes something away
 * (adapter, allocator, lower fee, a function given up for good). `change`: anything else.
 */
export type PendingChangeDirection = 'add' | 'remove' | 'change';

export interface VaultPendingChange {
  id: string;
  direction: PendingChangeDirection;
  title: string;
  /** Unix seconds when it can be applied; 0 when Morpho did not report it. */
  validAt: number;
}

const VAULT_PENDING_QUERY = `
  query VaultV2PendingChanges($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      performanceFee
      managementFee
      caps(first: 100) {
        items {
          id
          data {
            ... on MarketV1CapData {
              market { collateralAsset { symbol } loanAsset { symbol } }
            }
            ... on CollateralCapData { collateralAddress }
          }
        }
      }
      pendingConfigs(first: 50) {
        items {
          functionName
          txHash
          validAt
          decodedData {
            __typename
            ... on VaultV2AbdicatePendingData { functionName }
            ... on VaultV2IncreaseCapPendingData { cap config { id type } }
            ... on VaultV2SetIsAllocatorPendingData { isAllocator }
            ... on VaultV2SetManagementFeePendingData { managementFee }
            ... on VaultV2SetPerformanceFeePendingData { performanceFee }
            ... on VaultV2SetForceDeallocatePenaltyPendingData { forceDeallocatePenalty }
            ... on VaultV2TimelockPendingData { functionName timelock }
          }
        }
      }
    }
  }
`;

type NumericLike = string | number | null | undefined;

export interface VaultPendingGraphQL {
  performanceFee?: number | null;
  managementFee?: number | null;
  caps?: {
    items?: Array<{
      id?: string | null;
      data?: {
        market?: {
          collateralAsset?: { symbol?: string | null } | null;
          loanAsset?: { symbol?: string | null } | null;
        } | null;
        collateralAddress?: string | null;
      } | null;
    } | null> | null;
  } | null;
  pendingConfigs?: {
    items?: Array<{
      functionName?: string | null;
      txHash?: string | null;
      validAt?: NumericLike;
      decodedData?: {
        __typename?: string | null;
        functionName?: string | null;
        cap?: NumericLike;
        config?: { id?: string | null; type?: string | null } | null;
        isAllocator?: boolean | null;
        managementFee?: NumericLike;
        performanceFee?: NumericLike;
        forceDeallocatePenalty?: NumericLike;
        timelock?: NumericLike;
      } | null;
    } | null> | null;
  } | null;
}

/** WAD-scaled fee or penalty (1e18 = 100%) as a percent label, e.g. `10%`. */
function wadPercentLabel(value: NumericLike): string | null {
  if (value === null || value === undefined || value === '') return null;
  const percent = Number(value) / 1e16;
  if (!Number.isFinite(percent)) return null;
  return `${Math.round(percent * 100) / 100}%`;
}

/** `camelCaseName` → `camel case name`. */
function readableFunctionName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function capTargetLabel(
  config: { id?: string | null; type?: string | null } | null | undefined,
  labels: ReadonlyMap<string, string>
): string {
  const known = config?.id ? labels.get(config.id.toLowerCase()) : undefined;
  if (known) return known;
  switch (config?.type) {
    case 'MarketV1':
      return 'a market';
    case 'Collateral':
      return 'a collateral token';
    case 'Adapter':
      return 'an adapter';
    default:
      return 'a cap';
  }
}

/** Fee change direction against the current fee (Morpho reports both as fractions or WAD). */
function feeDirection(pendingWad: NumericLike, currentFraction: number | null | undefined): PendingChangeDirection {
  const pending = Number(pendingWad) / 1e18;
  const current = Number(currentFraction ?? 0);
  if (!Number.isFinite(pending)) return 'change';
  if (pending > current) return 'add';
  if (pending < current) return 'remove';
  return 'change';
}

/** Plain-language list of the vault's pending timelocked changes. */
export function mapVaultV2Pending(vault: VaultPendingGraphQL): VaultPendingChange[] {
  const capLabels = new Map<string, string>();
  for (const cap of vault.caps?.items ?? []) {
    if (!cap?.id) continue;
    const market = cap.data?.market;
    if (market?.collateralAsset?.symbol) {
      capLabels.set(
        cap.id.toLowerCase(),
        `the ${market.collateralAsset.symbol} / ${market.loanAsset?.symbol ?? '?'} market`
      );
    }
  }

  const changes: VaultPendingChange[] = [];
  (vault.pendingConfigs?.items ?? []).forEach((item, index) => {
    if (!item?.functionName) return;
    const fn = item.functionName;
    const decoded = item.decodedData ?? {};
    const rawValidAt = Number(item.validAt ?? 0);
    const validAt = Number.isFinite(rawValidAt) && rawValidAt > 0 ? rawValidAt : 0;
    const base = { id: `${item.txHash ?? 'pending'}-${index}`, validAt };

    switch (fn) {
      case 'addAdapter':
        changes.push({ ...base, direction: 'add', title: 'Add a new adapter (a new place funds can be allocated)' });
        return;
      case 'removeAdapter':
        changes.push({ ...base, direction: 'remove', title: 'Remove an adapter' });
        return;
      case 'increaseAbsoluteCap':
      case 'increaseRelativeCap':
        changes.push({
          ...base,
          direction: 'add',
          title: `Raise the cap on ${capTargetLabel(decoded.config, capLabels)}`,
        });
        return;
      case 'setPerformanceFee': {
        const label = wadPercentLabel(decoded.performanceFee);
        changes.push({
          ...base,
          direction: feeDirection(decoded.performanceFee, vault.performanceFee),
          title: label ? `Set the performance fee to ${label}` : 'Change the performance fee',
        });
        return;
      }
      case 'setManagementFee': {
        const label = wadPercentLabel(decoded.managementFee);
        changes.push({
          ...base,
          direction: feeDirection(decoded.managementFee, vault.managementFee),
          title: label ? `Set the management fee to ${label}` : 'Change the management fee',
        });
        return;
      }
      case 'setIsAllocator':
        changes.push({
          ...base,
          direction: decoded.isAllocator === false ? 'remove' : 'add',
          title: decoded.isAllocator === false ? 'Remove an allocator' : 'Add an allocator',
        });
        return;
      case 'abdicate':
        changes.push({
          ...base,
          direction: 'remove',
          title: decoded.functionName
            ? `Give up ${readableFunctionName(decoded.functionName)} for good`
            : 'Give up a curator function for good',
        });
        return;
      case 'setForceDeallocatePenalty': {
        const label = wadPercentLabel(decoded.forceDeallocatePenalty);
        changes.push({
          ...base,
          direction: 'change',
          title: label ? `Set the force-withdraw penalty to ${label}` : 'Change the force-withdraw penalty',
        });
        return;
      }
      case 'increaseTimelock':
      case 'decreaseTimelock':
        changes.push({
          ...base,
          direction: 'change',
          title: decoded.functionName
            ? `${fn === 'increaseTimelock' ? 'Lengthen' : 'Shorten'} the ${readableFunctionName(decoded.functionName)} timelock`
            : `${fn === 'increaseTimelock' ? 'Lengthen' : 'Shorten'} a timelock`,
        });
        return;
      default:
        changes.push({ ...base, direction: 'change', title: `Change: ${readableFunctionName(fn)}` });
    }
  });

  return changes.sort((a, b) => (a.validAt || Infinity) - (b.validAt || Infinity));
}

export async function fetchVaultV2Pending(
  vaultAddress: string,
  chainId: number
): Promise<{ pending: VaultPendingChange[] | null; error?: string; rateLimited?: boolean }> {
  try {
    const response = await fetchMorphoGraphQL(
      { query: VAULT_PENDING_QUERY, variables: { address: vaultAddress, chainId } },
      {
        revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS,
        tags: [`vault-pending-${vaultAddress}-${chainId}`],
      }
    );
    const { responseText, rateLimited } = await readMorphoGraphQLResponse(response);
    if (!response.ok) {
      return rateLimited
        ? { pending: null, error: 'Morpho API rate limit exceeded', rateLimited: true }
        : { pending: null, error: `Morpho API error: ${response.status}` };
    }
    const json = JSON.parse(responseText) as {
      errors?: unknown[];
      data?: { vaultV2ByAddress?: VaultPendingGraphQL | null };
    };
    if (json.errors?.length) {
      logger.warn('Vault pending GraphQL errors', { vaultAddress, chainId, errors: json.errors });
      return { pending: null, error: 'Failed to load pending changes' };
    }
    const vault = json.data?.vaultV2ByAddress;
    if (!vault) return { pending: null, error: 'Vault not found' };
    return { pending: mapVaultV2Pending(vault) };
  } catch (error) {
    logger.error(
      'Vault pending fetch failed',
      error instanceof Error ? error : new Error(String(error)),
      { vaultAddress, chainId }
    );
    return { pending: null, error: 'Failed to load pending changes' };
  }
}
