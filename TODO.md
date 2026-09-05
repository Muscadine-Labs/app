**To Work on Today:**

**To work on another day:**
- **Deposit gate — revert to on-chain RPC whitelist (optional):** Today the app uses a config-only depositor allowlist (gate UI always active) and never calls `sendAssetsGate` / `canSendAssets` over RPC. If we want live on-chain reads again, restore `useReadContracts` in `useUnderlyingDepositAccess.ts` and per-wallet `canSendAssets` (see git history / `curator npm run gates:verify` for expected on-chain state). Ops would still run `gates:verify` after allowlist changes.

**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain. 
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
