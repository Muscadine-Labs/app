import type { VaultStrategy } from '@/lib/vaults';

/** Morpho v2 liquidity breakdown (instant, idle, adapter, deallocatable, total). */
export interface VaultLiquidityBreakdown {
  instantLiquidityAssets: string;
  instantLiquidityUsd: number;
  idleLiquidityAssets: string;
  idleLiquidityUsd: number;
  liquidityAdapterAssets: string;
  liquidityAdapterUsd: number;
  deallocatableLiquidityAssets: string;
  deallocatableLiquidityUsd: number;
  totalUnderlyingLiquidityAssets: string;
  totalUnderlyingLiquidityUsd: number;
}

/** A Vault V2 function's timelock. `abdicated`: the function can never be called again. */
export interface VaultTimelock {
  functionName: string;
  /** Seconds. */
  duration: number;
  abdicated: boolean;
}

// Unified Vault type definition
export interface Vault {
    // Basic Information
    address: string;
    name: string;
    symbol: string;
    /** Share token symbol (e.g. mpUSDC, mfUSDC). */
    vaultSymbol?: string;
    chainId: number;
    version?: 'v1' | 'v2';
    strategy?: VaultStrategy;
    /** True when vault is in the Muscadine registry. */
    isCurated?: boolean;
    /** Underlying token contract. Pinned for Gauntlet and Steakhouse vaults. */
    assetAddress?: string;
    
    // Financial Metrics
    totalValueLocked?: number; // TVL in USD
    totalAssets?: string; // Total assets in native units (wei)
    totalSupply?: string; // Total supply of vault shares (in wei)
    assetDecimals?: number; // Asset decimals for formatting
    apy?: number; // Headline net APY (Morpho netApy)
    grossApy?: number; // Gross APY before vault fees (Morpho apy)
    netApyWithoutRewards?: number; // Net APY without reward incentives
    rewardsApr?: number; // Rewards APR from incentives
    rewardSymbol?: string; // Symbol of reward token
    apyChange?: number; // APY change (positive/negative)
    totalDeposits?: number; // Total deposits in USD
    currentLiquidity?: number; // Instant liquidity USD (idle + liquidity adapter) — transact checks
    liquidityAssets?: string; // Instant liquidity in native units — transact checks
    liquidityBreakdown?: VaultLiquidityBreakdown;
    sharePrice?: number; // Current vault share price (in tokens, not USD)
    sharePriceUsd?: number; // Current vault share price in USD
    
    // Security & Risk
    timelockDuration?: number; // Timelock in seconds
    
    // Status
    status?: 'active' | 'paused' | 'deprecated';
    
    // Curator Information
    curator?: string;
    curatorAddress?: string;
    guardianAddress?: string;
    oracleAddress?: string;
    ownerAddress?: string; // Vault owner address
    
    // Allocators
    allocators?: string[]; // Array of allocator addresses
    sentinels?: string[];
    timelocks?: VaultTimelock[];
    /** Max share price growth, per second, WAD-scaled (Vault V2 `maxRate`). */
    maxRate?: string | null;
    liquidityAdapterAddress?: string | null;
    /** Morpho GraphQL `__typename`, e.g. `MorphoMarketV1Adapter` or `MorphoVaultV2Adapter`. */
    liquidityAdapterType?: string | null;
    
    // Fees
    performanceFee?: number; // Percentage
    managementFee?: number; // Percentage
    
    // Additional Info
    description?: string;
    lastUpdated?: string;
    
    // Visual Properties
    icon?: string;
    color?: string;
}

// Extended vault data structure for Morpho vaults (includes all possible fields)
export interface MorphoVaultData extends Vault {
    // All fields are required for Morpho vaults
    totalValueLocked: number;
    totalSupply: string; // Total supply of vault shares (in wei)
    apy: number;
    grossApy: number;
    netApyWithoutRewards: number;
    rewardsApr: number;
    rewardSymbol: string;
    apyChange: number;
    totalDeposits: number;
    currentLiquidity: number;
    liquidityBreakdown?: VaultLiquidityBreakdown;
    sharePrice: number; // Share price in tokens (not USD)
    sharePriceUsd: number; // Share price in USD
    timelockDuration: number;
    guardianAddress: string;
    oracleAddress: string;
    ownerAddress: string;
    allocators: string[];
    status: 'active' | 'paused' | 'deprecated';
    curator: string;
    curatorAddress: string;
    performanceFee: number;
    managementFee: number;
    description: string;
}

// Vault symbol to logo mapping
export const VAULT_LOGO_MAP: Record<string, string> = {
    'USDC': '/usdc-logo.svg',
    'USD': '/usdc-logo.svg',
    'EURC': '/eurc-logo.svg',
    'USDT': '/usdt-logo.svg',
    'WETH': '/weth-logo.svg',
    'ETH': '/eth-logo.svg',
    'USDG': '/usdg-logo.svg',
    'CBTC': '/cbbtc-logo.svg',
    'cbbtc': '/cbbtc-logo.svg',
    'CBBTC': '/cbbtc-logo.svg',
    'cbBTC': '/cbbtc-logo.svg',
    'BTC': '/btc-logo.svg',
} as const;

// Function to get vault logo
export const getVaultLogo = (symbol: string): string => {
    // Try exact match first, then uppercase
    return VAULT_LOGO_MAP[symbol] || VAULT_LOGO_MAP[symbol.toUpperCase()] || '/usdc-logo.svg';
};

// Account types for transaction flow
export interface WalletAccount {
    type: 'wallet';
    address: 'wallet';
    symbol: string;
    balance: bigint;
    assetAddress?: string; // For token balances
}

export interface VaultAccount {
    type: 'vault';
    address: string;
    name: string;
    symbol: string;
    balance: bigint; // User's vault shares or withdrawable assets
    assetAddress: string; // Underlying asset address
    assetDecimals: number;
}

export type Account = WalletAccount | VaultAccount;
