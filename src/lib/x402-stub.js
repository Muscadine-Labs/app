// Coinbase CDP optionally imports @x402 for payment signing. These apps do not use that path.
export function toClientEvmSigner() {
  throw new Error("@x402 is not installed");
}
