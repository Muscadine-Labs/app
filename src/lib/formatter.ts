import { formatUnits, parseUnits, type Address } from 'viem';
import { getAssetDecimalsForSymbol } from '@/lib/asset-decimals';

/**
 * A flexible, locale-aware number formatter.
 * @param value - The number or string to format.
 * @param options - Intl.NumberFormat options (e.g., { maximumFractionDigits: 2 }).
 * @returns A formatted number string.
 */
export function formatNumber(
  value: number | string,
  options: Intl.NumberFormatOptions = {}
): string {
  const numberValue = Number(value);
  if (isNaN(numberValue)) return ''; // Return empty string for invalid numbers
  
  return new Intl.NumberFormat('en-US', options).format(numberValue);
}

/**
 * Formats a percentage value for display.
 * @param value - The decimal percentage value (e.g., 0.05 for 5%).
 * @param options - Formatting options (default: { decimals: 2, includeSign: false }).
 * @returns A formatted percentage string (e.g., "5.00%").
 */
export function formatPercentage(
  value: number | string,
  options: { decimals?: number; includeSign?: boolean } = {}
): string {
  const { decimals = 2, includeSign = false } = options;
  const numberValue = Number(value);
  if (isNaN(numberValue)) return '';
  
  const percentage = numberValue * 100;
  const formatted = formatNumber(percentage, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  return includeSign && percentage > 0 ? `+${formatted}%` : `${formatted}%`;
}

/**
 * A specialized formatter for currency values.
 * @param value - The number or string to format.
 * @param options - Additional Intl.NumberFormat options.
 * @returns A formatted currency string (e.g., "$1,234.56" or "$1.2M").
 */
export function formatCurrency(
  value: number | string,
  options: Intl.NumberFormatOptions = {}
): string {
  const defaultOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options, // User options will override defaults
  };
  return formatNumber(value, defaultOptions);
}

/**
 * Smart currency formatter that shows the most appropriate format based on value size.
 * @param value - The number or string to format.
 * @param options - Optional formatting options (e.g., { alwaysTwoDecimals: true }).
 * @returns A formatted currency string with appropriate precision (e.g., "$20", "$1.2K", "$2.5M").
 */
export function formatSmartCurrency(
  value: number | string,
  options?: { alwaysTwoDecimals?: boolean }
): string {
  const numberValue = Number(value);
  if (isNaN(numberValue)) return '$0';
  
  const absValue = Math.abs(numberValue);
  const alwaysTwoDecimals = options?.alwaysTwoDecimals ?? false;
  
  if (absValue < 1000) {
    // Show exact amount for values under $1,000
    return `$${numberValue.toFixed(2)}`;
  } else if (absValue < 1000000) {
    // Show in thousands
    return `$${(numberValue / 1000).toFixed(alwaysTwoDecimals ? 2 : 1)}K`;
  } else if (absValue < 1000000000) {
    // Show in millions
    return `$${(numberValue / 1000000).toFixed(alwaysTwoDecimals ? 2 : 1)}M`;
  } else {
    // Show in billions
    return `$${(numberValue / 1000000000).toFixed(alwaysTwoDecimals ? 2 : 1)}B`;
  }
}

/**
 * Canonical UI display fraction digits (not transactions).
 * USDC 6 · cbBTC / ETH / WETH 8 — full chain decimals only for txs.
 */
export function getDisplayFractionDigits(symbol: string): number {
  const normalized = symbol.toUpperCase();
  if (normalized === 'USDC' || normalized === 'USD') return 6;
  if (
    normalized === 'ETH' ||
    normalized === 'WETH' ||
    normalized === 'CBBTC' ||
    normalized === 'CBTC' ||
    normalized === 'BTC'
  ) {
    return 8;
  }
  return getAssetDecimalsForSymbol(symbol);
}

/** Vault detail My Position / earned interest — native decimals. */
export function getVaultDetailFractionDigits(symbol: string): number {
  return getDisplayFractionDigits(symbol);
}

/**
 * Formats a bigint token amount as a decimal string without floating-point loss.
 * Trims to maxFractionDigits and strips trailing zeros.
 */
export function formatUnitsForDisplay(
  value: bigint,
  decimals: number,
  maxFractionDigits: number
): string {
  const full = formatUnits(value, decimals);
  const negative = full.startsWith('-');
  const body = negative ? full.slice(1) : full;
  const [ints, fracs = ''] = body.split('.');
  const clipped = fracs.slice(0, Math.max(0, Math.min(maxFractionDigits, 20))).replace(/0+$/, '');
  const intFormatted = ints.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const result = clipped.length > 0 ? `${intFormatted}.${clipped}` : intFormatted;
  return negative ? `-${result}` : result;
}

/**
 * Formats asset amounts with native token precision (UI display).
 * Uses string/bigint path — Number loses precision past ~15 significant digits.
 */
export function formatAssetAmount(
  value: bigint | string,
  decimals: number,
  symbol: string,
  options: Intl.NumberFormatOptions = {}
): string {
  const fractionDigits = Math.min(getDisplayFractionDigits(symbol), 20);

  const maxDigits =
    typeof options.maximumFractionDigits === 'number'
      ? Math.min(options.maximumFractionDigits, 20)
      : fractionDigits;

  // When callers force fixed trailing zeros (min === max), pad fraction.
  const minDigits =
    typeof options.minimumFractionDigits === 'number' ? options.minimumFractionDigits : 0;

  const raw = typeof value === 'bigint' ? value : BigInt(value);
  // Keep compact `0 SYMBOL` unless fixed trailing decimals are requested (chart ticks).
  if (raw === BigInt(0) && !(minDigits > 0 && minDigits === maxDigits)) {
    return `0 ${symbol}`;
  }

  if (minDigits > 0 && minDigits === maxDigits) {
    const full = formatUnits(raw, decimals);
    const [ints, fracs = ''] = full.replace(/^-/, '').split('.');
    const padded = `${fracs}${'0'.repeat(maxDigits)}`.slice(0, maxDigits);
    const intFormatted = ints.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sign = full.startsWith('-') ? '-' : '';
    return `${sign}${intFormatted}.${padded} ${symbol}`;
  }

  return `${formatUnitsForDisplay(raw, decimals, maxDigits)} ${symbol}`;
}

/** Position / table token amount from raw chain units (native decimals). */
export function formatPositionTokenAmount(
  rawValue: string | undefined,
  decimals: number,
  symbol: string
): string {
  const fractionDigits = Math.min(getDisplayFractionDigits(symbol), 20);
  const zeroLabel = `${formatNumber(0, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })} ${symbol}`;

  if (!rawValue) return zeroLabel;

  try {
    const raw = BigInt(rawValue);
    if (raw === BigInt(0)) return zeroLabel;
    return formatAssetAmount(raw, decimals, symbol, {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return zeroLabel;
  }
}

/** Chart token toggles / axes — compact (not full 18) for readable ticks. */
export function getVaultChartTokenFractionDigits(symbol: string): number {
  const normalized = symbol.toUpperCase();
  if (normalized === 'USDC') return 2;
  if (
    normalized === 'WETH' ||
    normalized === 'ETH' ||
    normalized === 'CBBTC' ||
    normalized === 'CBTC' ||
    normalized === 'BTC'
  ) {
    return 6;
  }
  return 2;
}

/** Share-price charts — USDC needs an extra digit vs TVL (near-1.00 prices). */
export function getSharePriceTokenFractionDigits(symbol: string): number {
  const normalized = symbol.toUpperCase();
  if (normalized === 'USDC') return 3;
  return getVaultChartTokenFractionDigits(symbol);
}

/** viem parseUnits rejects scientific notation; chart values are already decimal numbers. */
export function chartTokenAmountToRaw(value: number, assetDecimals: number): bigint {
  if (!Number.isFinite(value)) return BigInt(0);
  const decimalString = value.toFixed(assetDecimals).replace(/\.?0+$/, '') || '0';
  return parseUnits(decimalString, assetDecimals);
}

/** Fixed fraction digits for chart Y-axis token ticks (USDC and default). */
const CHART_AXIS_STABLE_FRACTION_DIGITS = 2;

/** Fixed fraction digits for chart Y-axis WETH / cbBTC token ticks. */
const CHART_AXIS_WETH_CBBTC_FRACTION_DIGITS = 6;

/** Fraction digits for chart Y-axis token ticks. */
export function getChartTokenAxisFractionDigits(symbol: string): {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
} {
  const normalized = symbol.toUpperCase();
  const digits =
    normalized === 'WETH' ||
    normalized === 'ETH' ||
    normalized === 'CBBTC' ||
    normalized === 'CBTC' ||
    normalized === 'BTC'
      ? CHART_AXIS_WETH_CBBTC_FRACTION_DIGITS
      : CHART_AXIS_STABLE_FRACTION_DIGITS;

  return { minimumFractionDigits: digits, maximumFractionDigits: digits };
}

/** Share price Y-axis token ticks. */
export function formatSharePriceAxisTokenValue(
  value: number,
  assetDecimals: number,
  symbol: string
): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '';

  const digits = getSharePriceTokenFractionDigits(symbol);
  const resolvedDecimals = assetDecimals > 0 ? assetDecimals : 18;
  const formatted = formatAssetAmount(
    chartTokenAmountToRaw(numberValue, resolvedDecimals),
    resolvedDecimals,
    symbol,
    { minimumFractionDigits: digits, maximumFractionDigits: digits }
  );
  return formatted.replace(` ${symbol}`, '').trim();
}

/**
 * Compact USD label for chart Y-axis ticks ($85, $1.2K, $2.5M)
 * so labels stay short and do not clip in the axis gutter.
 */
export function formatChartUsdAxisValue(value: number): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '';

  const abs = Math.abs(numberValue);
  if (abs === 0) return '$0';

  if (abs < 1000) {
    if (abs >= 100) return `$${Math.round(numberValue)}`;
    if (abs >= 10) return `$${numberValue.toFixed(1)}`;
    return `$${numberValue.toFixed(2)}`;
  }
  if (abs < 1_000_000) {
    const k = numberValue / 1000;
    return `$${k >= 100 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  if (abs < 1_000_000_000) {
    const m = numberValue / 1_000_000;
    return `$${m >= 100 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  const b = numberValue / 1_000_000_000;
  return `$${b >= 100 ? b.toFixed(0) : b.toFixed(1)}B`;
}

/** Full token label for chart Y-axis ticks (no symbol suffix). */
export function formatChartTokenAxisValue(
  value: number,
  assetDecimals: number,
  symbol: string
): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '';

  const { minimumFractionDigits, maximumFractionDigits } =
    getChartTokenAxisFractionDigits(symbol);
  const resolvedDecimals = assetDecimals > 0 ? assetDecimals : 18;
  const formatted = formatAssetAmount(
    chartTokenAmountToRaw(numberValue, resolvedDecimals),
    resolvedDecimals,
    symbol,
    { minimumFractionDigits, maximumFractionDigits }
  );
  return formatted.replace(` ${symbol}`, '').trim();
}

/** Token amount for vault charts with fixed trailing zeros. */
export function formatVaultChartTokenAmount(
  value: number,
  assetDecimals: number,
  symbol: string,
  options: { includeSymbol?: boolean } = {}
): string {
  const { includeSymbol = true } = options;
  const fractionDigits = getVaultChartTokenFractionDigits(symbol);
  const resolvedDecimals = assetDecimals > 0 ? assetDecimals : 18;
  const formatted = formatAssetAmount(
    chartTokenAmountToRaw(value, resolvedDecimals),
    resolvedDecimals,
    symbol,
    { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
  );
  if (!includeSymbol) {
    return formatted.replace(` ${symbol}`, '').trim();
  }
  return formatted;
}

/** Share price token label (USDC uses 3 decimals; other assets match chart token digits). */
export function formatSharePriceTokenAmount(
  value: number,
  assetDecimals: number,
  symbol: string,
  options: { includeSymbol?: boolean } = {}
): string {
  const { includeSymbol = true } = options;
  const fractionDigits = getSharePriceTokenFractionDigits(symbol);
  const resolvedDecimals = assetDecimals > 0 ? assetDecimals : 18;
  const formatted = formatAssetAmount(
    chartTokenAmountToRaw(value, resolvedDecimals),
    resolvedDecimals,
    symbol,
    { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
  );
  if (!includeSymbol) {
    return formatted.replace(` ${symbol}`, '').trim();
  }
  return formatted;
}

/** Share price in USD — standard currency formatting. */
export function formatSharePriceUsd(value: number): string {
  return formatCurrency(value);
}

/** Vault detail page: deposits + earned interest (native decimals, fixed trailing zeros). */
export function formatVaultDetailTokenAmount(
  rawValue: string | undefined,
  decimals: number,
  symbol: string
): string {
  const fractionDigits = Math.min(getVaultDetailFractionDigits(symbol), 20);
  const zeroLabel = `${formatNumber(0, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ${symbol}`;

  if (!rawValue) return zeroLabel;

  try {
    const raw = BigInt(rawValue);
    if (raw === BigInt(0)) return zeroLabel;
    return formatAssetAmount(raw, decimals, symbol, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return zeroLabel;
  }
}

/** Full-precision position USD (always 2 decimals, no K/M/B). */
export function formatPositionUsd(value: number): string {
  return formatCurrency(value);
}

/**
 * Formats BigInt balance directly to input string format.
 * This avoids floating-point precision issues by working directly with BigInt.
 * 
 * @param balance - The BigInt balance from the contract.
 * @param decimals - The contract decimals (e.g., 18 for ETH, 6 for USDC, 8 for BTC).
 * @returns Formatted string with full precision, suitable for parseUnits.
 */
export function formatBigIntForInput(
  balance: bigint,
  decimals: number
): string {
  if (balance === BigInt(0)) {
    return '0';
  }
  
  // Use formatUnits directly - this is the most accurate way to convert BigInt to decimal string
  // formatUnits handles the conversion without any floating-point precision loss
  return formatUnits(balance, decimals);
}

/**
 * Formats asset balance for display (unified function for both wallet and vault balances).
 * Uses appropriate precision based on symbol and asset decimals.
 * For small amounts, shows more precision to avoid rounding to zero.
 * @param balance - The balance value (string or number).
 * @param symbol - The asset symbol (e.g., 'ETH', 'WETH', 'USDC', 'cbBTC').
 * @param assetDecimals - Optional asset decimals (used to determine precision if symbol doesn't match known patterns).
 * @param includeSymbol - Whether to include the symbol in the output (default: true).
 * @returns Formatted balance string (e.g., "1.2345 ETH" or "1.23" if includeSymbol is false).
 */
export function formatAssetBalance(
  balance: string | number,
  symbol: string,
  assetDecimals?: number,
  includeSymbol: boolean = true
): string {
  // Transaction / available balance UI: full token decimals
  const maxPrecision = assetDecimals ?? getAssetDecimalsForSymbol(symbol);
  
  // For string inputs, try to work with the string directly for better precision
  // Only parse to number when necessary
  let numValue: number;
  let balanceStr: string;
  
  if (typeof balance === 'string') {
    balanceStr = balance.trim();
    if (balanceStr === '' || balanceStr === '0') {
      return includeSymbol ? `0.00 ${symbol}` : '0.00';
    }
    numValue = parseFloat(balanceStr);
  } else {
    numValue = balance;
    balanceStr = balance.toString();
  }
  
  if (isNaN(numValue) || numValue < 0) {
    return includeSymbol ? `0.00 ${symbol}` : '0.00';
  }
  
  // Check if value is zero - use string check for accuracy when available
  if (typeof balance === 'string') {
    // Check the original string to see if it's truly zero (handles very small numbers that might round to 0)
    const isZeroPattern = /^0+\.?0*$/.test(balanceStr);
    if (isZeroPattern) {
      return includeSymbol ? `0.00 ${symbol}` : '0.00';
    }
  }
  
  // Check if value is zero
  if (numValue === 0 || (Math.abs(numValue) < 1e-18)) {
    // For extremely small values that round to 0, check if original string had content
    if (typeof balance === 'string' && balanceStr && !/^0+\.?0*$/.test(balanceStr)) {
      // String has non-zero content, continue
    } else {
      return includeSymbol ? `0.00 ${symbol}` : '0.00';
    }
  }
  
  let precision: number;
  
  // Always find the first significant digit to determine precision
  // This works for both small and large numbers
  let decimalPlaces = 0;
  let temp = Math.abs(numValue);
  precision = maxPrecision; // Default to full precision
  
  // Find first significant digit for values less than 1
  if (temp > 0 && temp < 1) {
    while (temp < 1 && decimalPlaces < maxPrecision) {
      temp *= 10;
      decimalPlaces++;
      if (temp >= 1 || decimalPlaces >= maxPrecision) {
        // Found first significant digit at decimalPlaces position
        // Show first significant digit plus 2-4 more places for clarity, up to max precision
        precision = Math.min(decimalPlaces + 4, maxPrecision);
        break;
      }
    }
  } else {
    // For values >= 1, use full precision up to maxPrecision
    precision = maxPrecision;
  }
  
  // Format with calculated precision using formatNumber to get comma separators
  // Clamp precision to 20 to avoid Intl.RangeError (Intl.NumberFormat max is 20)
  const safePrecision = Math.min(precision, 20);
  const formatted = formatNumber(numValue, {
    minimumFractionDigits: 0,
    maximumFractionDigits: safePrecision,
  });
  
  // Remove trailing zeros, but keep at least one digit after decimal if there was a decimal point
  const trimmed = formatted.includes('.') 
    ? formatted.replace(/0+$/, '').replace(/\.$/, '')
    : formatted;
  
  return includeSymbol ? `${trimmed} ${symbol}` : trimmed;
}

/**
 * Truncates an Ethereum address for concise display.
 * @param address - The full address string.
 * @param startLength - Number of characters to show at the start (default: 6).
 * @param endLength - Number of characters to show at the end (default: 4).
 * @returns A truncated address string (e.g., "0x1234...5678").
 */
export function truncateAddress(
  address?: Address,
  startLength: number = 6,
  endLength: number = 4
): string {
  if (!address) return '';
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}

/**
 * Formats a date for display in a consistent format.
 * @param date - The date to format (Date object, timestamp, or date string).
 * @param options - Intl.DateTimeFormat options (default: { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).
 * @returns A formatted date string.
 */
export function formatDate(
  date: Date | number | string,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  const dateObj = typeof date === 'number' 
    ? new Date(date * 1000) // Assume timestamp is in seconds
    : typeof date === 'string'
    ? new Date(date)
    : date;
  
  if (isNaN(dateObj.getTime())) {
    return '';
  }
  
  return dateObj.toLocaleString('en-US', options);
}