/**
 * Application-wide constants
 */

// Chain configuration
export const BASE_CHAIN_ID = 8453 as const;
export const BASE_CHAIN_NAME = 'Base';
export function getChainDisplayName(chainId: number): string {
  if (chainId === BASE_CHAIN_ID) return BASE_CHAIN_NAME;
  return `Chain ${chainId}`;
}
export const BASE_WETH_ADDRESS = '0x4200000000000000000000000000000000000006' as const;
/** Morpho Vault V2 `forceDeallocate` (cash force-withdraw; not in-kind). */
export const MORPHO_FORCE_DEALLOCATE_DOCS_URL =
  'https://docs.morpho.org/learn/concepts/vault-v2/#1-in-kind-redemptions-with-forcedeallocate' as const;
/** Morpho protocol disclaimer (integrator UX requirement). */
export const MORPHO_DISCLAIMER_URL = 'https://morpho.org/disclaimers' as const;
/** Morpho Bundler3 on Base — atomic multi-step vault/WETH flows. */
export const BUNDLER3_ADDRESS = '0x6BFd8137e702540E7A42B74178A4a49Ba43920C4' as const;
/** Morpho GeneralAdapter1 on Base (wrap/unwrap + ERC-4626 via Bundler3). */
export const GENERAL_ADAPTER_ADDRESS = '0xb98c948CFA24072e58935BC004a8A7b376AE746A' as const;

// Cache durations (in milliseconds)
export const CACHE_DURATION_PRICES = 10 * 60 * 1000; // 10 minutes

// Transaction configuration
/** ETH kept in wallet when wrapping for WETH vault deposits (matches transactionUtilsV2). */
export const ETH_GAS_RESERVE = 0.0001;
/** 0.0001 ETH in wei — same reserve as `ETH_GAS_RESERVE`. */
export const ETH_GAS_RESERVE_WEI = BigInt(100_000_000_000_000);
/** Delay before follow-up balance refresh after tx (Morpho indexer lag). */
export const POST_TX_BALANCE_REFRESH_DELAY_MS = 5000;

// Morpho GraphQL API
export const MORPHO_GRAPHQL_URL = 'https://api.morpho.org/graphql' as const;
/** Next.js fetch revalidate for Morpho route handlers (seconds). */
export const MORPHO_GRAPHQL_REVALIDATE_SECONDS = 60; // 60 seconds
/** Browser `VaultDataContext` cache — matches server Morpho route revalidate. */
export const CLIENT_VAULT_DATA_CACHE_MS = MORPHO_GRAPHQL_REVALIDATE_SECONDS * 1000;
export const MORPHO_FETCH_TIMEOUT_MS = 10_000;
export const MORPHO_MAX_RETRIES = 3;
/** In-memory Morpho response cache TTL in `fetchMorphoGraphQL` (dev and production). */
export const MORPHO_MEMORY_CACHE_MS = 60_000;
/** Vault list preload concurrency — small batches avoid Morpho rate-limit bursts. */
export const MORPHO_PRELOAD_BATCH_SIZE = 2;
/** Back off failed Morpho fetches (rate limits, 5xx) before retrying the same vault. */
export const MORPHO_FETCH_ERROR_COOLDOWN_MS = 60_000;

// Price API configuration
export const STABLECOIN_SYMBOLS = ['USDC', 'USDT', 'DAI', 'USDBC', 'USDB'] as const;
export const DEFAULT_ASSET_PRICE = 1;
export const DEFAULT_ASSET_DECIMALS = 18;
