**To Work on Today:**
- Review the miniapp congifuration for the base app. Might be a base app issue or repo issue because i have to manually search up our app on base app. Also on base app, review why on the miniapp it takes a long time to load into it, than it blanks, than it loads up and correctly works. Review the docs and anaylze the code.

**To work on another day:**

Considering:
-Withdraws and deposits are blocked for non-muscadine vaults, have the ability on withdraw or deposit on the non-muscadine vault page to be able to deposit or withdraw from the /trascact page. We might need to refractor the repo to be able to be more fluid / dynamic, with a whitelist on /vaults of the muscadine vaults. Maybe instead of a /transcaction page it would be a model on the vault pages when depositing/withdrawing. Rearch this and find the best design. 
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate math and contract ABI paths before changing transaction code.
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
- **Vault v2 force exit when withdraw > liquidity:** Currently in-app withdraw warns (preview banner + confirm modal with Morpho link) when amount exceeds instant liquidity and on-chain simulation fails; user can continue anyway. Still TODO: auto-route via `forceDeallocate` then `withdraw`/`redeem` in `transactionUtilsV2.ts` (or Morpho SDK `forceWithdraw`/`forceRedeem`). Users can force-exit via [Morpho app](https://app.morpho.org) in the meantime. Ref: [Morpho force deallocate](https://morpho-org-vault-v2.mintlify.app/operations/force-deallocate).
