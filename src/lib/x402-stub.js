// Coinbase CDP optionally imports @x402 for payment signing. AppKit 2 installs the package,
// but this app never takes that path, so next.config.ts aliases it here to keep it out of the bundle.
export function toClientEvmSigner() {
  throw new Error("@x402 payment signing is not used by this app");
}
