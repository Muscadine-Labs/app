**To Work on Today:**
- Fix coderabbitai comments on the pr request
- One dashboard, when we show all of the users morpho vault positions (inlcluding non muscadine vaults, have the ability to click on the position and lead to the the /vault/v2 page for the vault. Than on the page for withdraw/deposit lead to a model that says on this frontend you cannot interact with this vault, if you wish to depsoit/withdraw from this vault you must do it through the morpho front end, than have a continue or cancel button with continue being linkted to the morpho vault front end website. Also, review all of the calls for api and abi on these pages to make sure we dont double call for certain things. Tell me how you would impliment this feature. 
- **Vault v2 My Position chart — stacked principal + interest:** On `/vault/v2/[address]` My Position tab, show two stacked area lines instead of one total line: bottom = deposited amount (cumulative net deposits from activity), top = earned interest (position value − principal), summing to total. Fetch `/api/vault/v2/{address}/activity` (deposits/withdrawals) and split each position-history point via `interest-utils` (`buildActivityFlowEvents`, `netDepositRawAtTime`, `splitPositionValueAtPoint`). Recharts stacked `Area` (primary = deposited, success = interest), legend + tooltip with Deposited / Earned interest / Total. Fallback to single line if activity unavailable. Morpho v2 has no historical PnL series — interest over time is derived from activity + position history.


**To work on another day:**

- **Vault v2 force exit when withdraw > liquidity:** In-app withdraw warns (preview banner + confirm modal with Morpho link) when amount exceeds instant liquidity and on-chain simulation fails; user can continue anyway. Still TODO: auto-route via `forceDeallocate` then `withdraw`/`redeem` in `transactionUtilsV2.ts` (or Morpho SDK `forceWithdraw`/`forceRedeem`). Users can force-exit via [Morpho app](https://app.morpho.org) in the meantime. Ref: [Morpho force deallocate](https://morpho-org-vault-v2.mintlify.app/operations/force-deallocate).


Considering:
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate math and contract ABI paths before changing transaction code.
- Add support for new vaults in the summer I'll make new v2 vaults on ethereum and/or other networks if implimented.
- Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
- Make this website a safe app i can use for my multi sigs - https://github.com/safe-global/safe-apps-sdk.

