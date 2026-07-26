**To Work on Today:**

**To work on another day:**

### Transaction paths

**Shipped:**
- **Normal deposit/withdraw/redeem:** Direct ERC-4626 in `transactionUtilsV2.ts`.
- **WETH Prime multi-step (ETH wrap / unwrap):** Morpho **Bundler3** + **GeneralAdapter1** (`src/lib/bundler3.ts`) — one user `multicall` after any needed approvals.
  - Deposit ETH/ALL: fund adapter → `wrapNative` → optional WETH `transferFrom` → `erc4626Deposit` (reverts if share price moves worse than **0.5%** vs quote).
  - Withdraw/redeem → ETH: approve shares to adapter → `erc4626Withdraw|Redeem` (receiver=adapter, same **0.5%** min share-price bound) → `unwrapNative`.
  - Resume leftover wallet WETH (force→ETH unwrap failure only): approve WETH → `transferFrom` + `unwrapNative` (amount from exit receipt logs).
- **Force withdraw when amount > instant liquidity:** Plan + simulate via `force-withdraw-v2.ts` (`forceDeallocate` × N + `withdraw`, or **`redeem` on MAX**). Prefers low-penalty markets; penalty burns shares. Warning modal + Morpho link. Optional ETH unwrap is a follow-up Bundler3 tx.
- **External vaults:** listed in UI (dashboard / wallet filters) with External label; **not clickable**; `/vault/v2/{external}` redirects home. Whitelisted-only detail + in-app transact.
- **Developer mode removed** — no over-balance bypass; Settings is theme only.
- **Dashboard asset surface:** Tokens / Stocks panels, `/asset/usdc|btc|eth`, compact wallet strip.

**Future (optional):**
- Switch force exit to [morpho-org/bundles](https://github.com/morpho-org/bundles) `vaultExitBundlesV1ForceWithdrawVaultV2` when Base addresses exist.
- Fold force+ETH unwrap into one Bundler3 flow if Morpho adds Base exit bundles.
- Vault-to-vault migrate / deposit Permit2 via Morpho bundles or SDK when ready.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- ABI vs Morpho SDK for v2 txs: keep direct ABIs as default until wagmi 2.x constraint clears.
