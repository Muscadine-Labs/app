**To Work on Today:**

**Completed:**
- **Deposit gate:** the config allowlist paints first. `canSendAssets` can add a wallet that is not in the config. A false or failed read does not remove a config allowlist, so a listed wallet does not change on screen while the check is in flight.
- **Wrapper and underlying force withdraw:** underlying vaults use an on-chain `multicall`. Fee wrappers use one Bundler3 bundle: child `forceDeallocate` at 0% penalty, then a GeneralAdapter1 withdraw. Vault V2 `maxWithdraw` is not used. If the markets cannot cover the amount, the input is capped at the reachable amount. The plan is rebuilt immediately before it is sent.
- **Wrapper liquidity:** the displayed total includes what a child force-deallocate can free, capped by the wrapper's position in the child.
- **Vault filter:** All / Underlying / Wrappers is stored per wallet and restored on the next visit.
- **Morpho SDK / GraphQL:** the app does not depend on `@morpho-org/morpho-sdk`. Vault reads stay on `vaultV2ByAddress`.

**To work on another day:**
- Update dependencies with npm. A full `npm update` pulled wallet packages that this Next build cannot resolve (`@wagmi/core/tempo` and `@x402`). Direct dependencies stay on the lockfile versions that build.

**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
