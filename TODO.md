**To Work on Today:**

**Completed:**
- **Deposit gate:** the allowlist constant is gone. Each vault's `canSendAssets` / `canReceiveShares` is read on chain as soon as the app and wallet load, so removing a gate opens that vault to everyone without a redeploy. Wrappers are checked the same way, plus their liquidity adapter. Deposits re-check on chain before any approval. Withdraw stays open. Scenario-checked: adapter removed from the whitelist, gates removed from some or all underlyings, gates added to wrappers or `receiveSharesGate`, wallet removed, GeneralAdapter1 whitelisted, RPC down.
- **Kind labels:** only where kinds mix. A vault outside the current list kind is labeled, along with the other side of its pair: a held wrapper on the Underlying list, an underlying held without deposit access, or an underlying added to the Wrappers list. A single-kind list (for example, a whitelisted wallet holding only underlyings) has no labels. Wallets that cannot deposit into every underlying open on wrappers; they get the switch only if they hold underlying shares, and that Underlying list is view-only (deposits blocked, withdrawals open).
- **Wrapper and underlying force withdraw:** underlying vaults use an on-chain `multicall`. Fee wrappers use one Bundler3 bundle: child `forceDeallocate` at 0% penalty, then a GeneralAdapter1 withdraw. Vault V2 `maxWithdraw` is not used. If the markets cannot cover the amount, the input is capped at the reachable amount. The plan is rebuilt immediately before it is sent.
- **Wrapper liquidity:** the displayed total includes what a child force-deallocate can free, capped by the wrapper's position in the child.
- **Vault filter:** settings toggles Wrappers / Underlying for the current visit only. Wallets that can deposit into every underlying vault open on Underlying every time; everyone else opens on Wrappers.
- **Morpho SDK / GraphQL:** the app does not depend on `@morpho-org/morpho-sdk`. Vault reads stay on `vaultV2ByAddress`.
- **Force withdraw review fixes:** retry after a force exit to ETH resumes the unwrap from the force tx hash (not step 0), so it no longer reads the share approval or re-runs the exit. Underlying force plans no longer drain the liquidity route market (plans on mpUSDC used to fail simulation). Withdraws always simulate first; instant liquidity for planning is read on-chain. Share approvals skip the reset-to-0 tx. Wrapper liquidity reads in `/complete` are batched and time-limited.
- **Manual check still to do:** a small wmpWETH force withdraw to ETH on Base where the share approval comes first, including cancelling the unwrap and using Try again.

**To work on another day:**
- Update dependencies with npm. A full `npm update` pulled wallet packages that this Next build cannot resolve (`@wagmi/core/tempo` and `@x402`). Direct dependencies stay on the lockfile versions that build.

**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
