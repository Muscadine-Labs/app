**To Work on Today:**


**To work on another day:**

Considering:
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate math and contract ABI paths before changing transaction code.
- Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
- **Vault v2 force exit when withdraw > liquidity:** In-app withdraw warns (preview banner + confirm modal with Morpho link) when amount exceeds instant liquidity and on-chain simulation fails; user can continue anyway. Still TODO: auto-route via `forceDeallocate` then `withdraw`/`redeem` in `transactionUtilsV2.ts` (or Morpho SDK `forceWithdraw`/`forceRedeem`). Users can force-exit via [Morpho app](https://app.morpho.org) in the meantime. Ref: [Morpho force deallocate](https://morpho-org-vault-v2.mintlify.app/operations/force-deallocate).

