import { maxUint256 } from 'viem';

/** Morpho SDK default share-price slippage: 0.03%. */
export const MORPHO_DEFAULT_SLIPPAGE_BPS = BigInt(3);

const SHARE_PRICE_SCALE_E27 = BigInt(10) ** BigInt(27);

/** Upper-bound assets paid per share, scaled by 1e27, from a fresh quote. */
export function maxSharePriceE27FromQuote(
  assets: bigint,
  shares: bigint,
  slippageBps: bigint = MORPHO_DEFAULT_SLIPPAGE_BPS
): bigint {
  if (shares === BigInt(0) || assets === BigInt(0)) return maxUint256;
  const price = (assets * SHARE_PRICE_SCALE_E27) / shares;
  return price + (price * slippageBps) / BigInt(10_000) + BigInt(1);
}

/** Lower-bound assets received per share, scaled by 1e27, from a fresh quote. */
export function minSharePriceE27FromQuote(
  assets: bigint,
  shares: bigint,
  slippageBps: bigint = MORPHO_DEFAULT_SLIPPAGE_BPS
): bigint {
  if (shares === BigInt(0) || assets === BigInt(0)) return BigInt(0);
  const price = (assets * SHARE_PRICE_SCALE_E27) / shares;
  const slip = (price * slippageBps) / BigInt(10_000);
  return price > slip ? price - slip : BigInt(0);
}
