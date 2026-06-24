/**
 * Application-wide constants
 */

// Chain configuration
export const BASE_CHAIN_ID = 8453 as const;
export const BASE_WETH_ADDRESS = '0x4200000000000000000000000000000000000006' as const;
export const GENERAL_ADAPTER_ADDRESS = '0xb98c948CFA24072e58935BC004a8A7b376AE746A' as const;

// Cache durations (in milliseconds)
export const CACHE_DURATION_VAULT_DATA = 5 * 60 * 1000; // 5 minutes
export const CACHE_DURATION_PRICES = 10 * 60 * 1000; // 10 minutes
export const CACHE_DURATION_ACTIVITY = 60 * 1000; // 1 minute

// Transaction configuration
export const MAX_WITHDRAW_QUEUE_ITEMS = 30; // Maximum items to fetch from withdraw queue
/** ETH kept in wallet when wrapping for WETH vault deposits (matches transactionUtilsV2). */
export const ETH_GAS_RESERVE = 0.0001;
/** Extra pause before WETH unwrap so wallet/RPC balance catches up after vault withdraw. */
export const UNWRAP_SETTLE_DELAY_MS = 2000;
/** Delay before follow-up balance refresh after tx (Morpho indexer lag). */
export const POST_TX_BALANCE_REFRESH_DELAY_MS = 5000;

// Request timeouts
export const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// Morpho GraphQL API
export const MORPHO_GRAPHQL_URL = 'https://api.morpho.org/graphql' as const;
/** Next.js fetch revalidate for Morpho route handlers (seconds). */
export const MORPHO_GRAPHQL_REVALIDATE_SECONDS = 60; // 60 seconds
export const MORPHO_FETCH_TIMEOUT_MS = 10_000;
export const MORPHO_MAX_RETRIES = 3;
/** In-memory Morpho response cache TTL in production (dev uses CACHE_DURATION_VAULT_DATA). */
export const MORPHO_MEMORY_CACHE_MS = 60_000;
/** Vault list preload concurrency — small batches avoid Morpho rate-limit bursts. */
export const MORPHO_PRELOAD_BATCH_SIZE = 2;
/** Back off failed Morpho fetches (rate limits, 5xx) before retrying the same vault. */
export const MORPHO_FETCH_ERROR_COOLDOWN_MS = 60_000;

// Price API configuration
export const STABLECOIN_SYMBOLS = ['USDC'] as const;
export const DEFAULT_ASSET_PRICE = 1;
export const DEFAULT_ASSET_DECIMALS = 18;
