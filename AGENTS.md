# AGENTS.md — Muscadine Vaults

Instructions for AI agents working in this repo. Full architecture docs live in `CLAUDE.md` — read it before non-trivial changes.

## Working agreement

1. **Review `TODO.md` at the start of every session.** It is the canonical task list:
   - “TO work on today” → actionable now.
   - “Needs confirmation first” → research or report only; do not implement without user OK.
   - “To work on another day” → backlog; do not start without being asked.
   - Update/remove entries as work completes.
2. **Before every push to GitHub:** run `npm run lint` and `npm run build` locally; both must pass. GitHub Actions only runs lint (no build, no env keys). Never push to github without users specific permission or order.
3. **Git commits only when the user explicitly asks.**
4. Keep `CLAUDE.md` and this file updated when conventions or architecture knowledge change.

## Key constraints

- **wagmi must stay on 2.x** (Reown AppKit requirement). **eslint stays on 9.x**. Pin **`qr@0.5.5`** in `package.json` overrides (WalletConnect QR `border=0` crash with `qr@0.6.0`). Keep a **root `valtio`** (AppKit/Turbopack `valtio/vanilla` resolve). Keep **`ox` on 0.14.x**. Keep **`allowScripts`** in `package.json` in sync with lockfile versions for `bufferutil`, `keccak`, `unrs-resolver`, `utf-8-validate`, and `@reown/appkit` (npm 11+ install-script allowlist; silences Vercel `allow-scripts-pending`). Keep Dependabot-patched transitive pins in **`overrides`**: `axios`, `hono`, `js-yaml` 4.3.1, `socket.io-parser`, `brace-expansion@1` / `@5`, `browserslist` 4.28.7, `decode-uri-component` 0.5.0.
- **Base only** (chain id 8453). **v1 MetaMorpho removed** — registry and writes are v2 Prime/Frontier only.
- **Builder code** `bc_mwkqu9rd` on all vault txs via `src/lib/builder-code.ts`.
- **v2 writes:** direct ERC-4626 in `transactionUtilsV2.ts`. Morpho Bundler3 in `bundler3.ts` for ETH wrap/unwrap and fee-wrapper force withdraws. No Morpho npm bundler SDK. Approve shares to GeneralAdapter1, never Bundler3.
- Registry: `src/lib/vaults.ts` — fields include `strategy` (`prime` | `frontier`), `kind` (`wrapper` | `underlying`), `vaultSymbol` (e.g. `wmpUSDC`, `mpUSDC`, `wmpcbBTC`). Explorer uses gate-driven visibility (`useUnderlyingDepositAccess`, `vault-access.ts`). Confirm Morpho dead shares (`0x…dEaD`) **before listing**; do not add a runtime RPC check — curated vaults already have them.
- **Deposit gates:** config allowlist paints first, then `canSendAssets` (`useUnderlyingDepositAccess`). On-chain `true` can add a wallet. On-chain `false` or a failed read does not remove a config allowlist. Sync the allowlist from curator; run curator `npm run gates:verify` after allowlist edits. See `CLAUDE.md` § Configuration. Kind filter (All / Underlying / Wrappers) is cached per wallet in `localStorage`.
- **No “Powered by Morpho” badge** on vault pages (looks tacky). Morpho attribution is the disclaimer: first-connect advisory, NavBar Protocol link, and review/confirm.
- Use `findVaultByAddress` / `isCuratedVaultAddress` from `src/lib/vault-utils.ts` — never infer vault by asset symbol alone. Wrapper allocations show `{amount} to {underlying vault}` then nested underlying-vault markets; the group name and allocations footer link to Muscadine Analytics (`getVaultAnalyticsUrl`), not the in-app vault page.
- Use `logger` from `src/lib/logger.ts`, not `console.log`.
- **Token display decimals:** UI via `getDisplayFractionDigits` — USDC **6**, cbBTC/ETH/WETH **8**. Prefer raw `bigint` amounts. **Transactions** always use full token decimals (`formatBigIntForInput` — ETH 18, cbBTC 8, USDC 6). Chart axes stay compact.
- **No developer / over-balance bypass mode** — `VaultVersionContext` removed. Explorer filters default to All for strategy/asset; transact blocks amounts over balance. `/vaults` defaults to **Wrappers** for the public; allowlisted depositors (and wallets with underlying shares) get a Vaults filter (All / Underlying / Wrappers), default **Underlying** for allowlisted.

## Dashboard & positions

- **Wallet strip:** Total / Wallet (liquid) / Vaults USD (`WalletOverview`).
- **Your Vaults** (dashboard): **v2** positions only (registry + external Morpho v2 vaults). **wrapper** / **underlying** pills only when the wallet holds **both** sides of a pair.
- **Morpho Vaults total** includes **all** user v2 positions from Morpho (`/api/user/morpho-positions`), not only Muscadine registry vaults.
- **External vaults** (not in `vaults.ts`): shown on dashboard / explorer wallet filters with an **External** label, **not clickable**. Navigation uses `isCuratedVaultAddress()`; `/vault/v2/{external}` redirects home.
- **Portfolio chart:** v2 positions via `/api/user/morpho-positions` + `/api/vault/v2/.../position-history` (`aggregatePortfolioHistory` in `portfolio-utils.ts`). Keep zero-share v2 rows for history when `includeEmpty=true`.
- **Morpho positions fetch:** `WalletContext` clears on wallet switch, keeps last snapshot on soft-fail for the same wallet, and ignores stale responses after a switch. Server retries transient Morpho 429/502/503/504; client adds at most one light retry when `retryable`.
- **Earned interest:** `/api/vault/v2/.../earned-interest` + `useVaultEarnedInterest` for all-time (shows **0** when never deposited). My Position header (left column, beside Your Position) shows total earned; past periods and future estimates live in the transact panel Past/Future toggle (`interest-utils.ts`). Use `resolveAssetDecimals` / `getAssetDecimalsForSymbol`.

## Transaction gotchas (WETH / Bundler3)

- Wrap ETH via Bundler3: fund adapter with empty calldata + `value`, then `wrapNative` with `value: 0` (`wrapNative` is non-payable).
- Withdraw → ETH: approve **shares** to GeneralAdapter, then one Bundler3 multicall (exit to adapter → `unwrapNative`).
- Bundler wrap/unwrap share-price bounds: **0.03%** from on-chain quotes (`BUNDLER_SLIPPAGE_BPS`, Morpho SDK default). Wrap deposits refuse a zero `convertToShares` quote before approve, then re-quote after approvals for `maxSharePrice`. Direct ERC-4626 deposits skip that read.
- Approval and main txs: `waitForSuccessfulReceipt` — a reverted receipt must not continue to the next step.
- Resume unwrap only after the force exit tx was sent (hash tracked by the **Force withdraw** label, not step 0 — share approvals can come first) and a later step failed; never re-force on WETH approval / unwrap failure. Withdraws always simulate the plain exit first; the force planner reads instant liquidity on-chain and never force-deallocates the liquidity route market. Vault share approvals never reset to 0 first.
- Force withdraw: **underlying vaults** use vault `multicall` (`forceDeallocate` + withdraw/redeem) on Blue markets. **Fee wrappers** use one Bundler3 bundle: child `forceDeallocate` (0% penalty), then GeneralAdapter1 `erc4626Withdraw`/`erc4626Redeem`. Approve wrapper shares to GeneralAdapter1, never Bundler3. Do not use Vault V2 `maxWithdraw`. ETH unwrap after force is a second Bundler3 tx and only when the vault asset is WETH.

## Known gotchas

- Morpho GraphQL invalid fields fail the whole request (HTTP 400).
- New vaults / fee wrappers often have TVL before `avgNetApy` or position history is indexed. `stripIncompleteVaultHistoryBuckets` keeps TVL points; `finalizePositionHistory` seeds a short live-position line when history is empty. Overview hides the APY chart until a positive rate exists.
- Morpho public API rate limit (429) / blips (502): `fetchMorphoGraphQL()` retries transient statuses. Positions route returns **503** + `retryable` for rate-limit/transient; other failures **502** without retryable spam.
- Morpho asset USD price: query `price { usd }`; parse via `resolveMorphoAssetPriceUsd()` in `api-utils.ts`.
- Overlay scroll lock: use `useLockPageScroll()` — locks `body` and `[data-app-scroll]` in `AppLayout`. Reference counted, so nested overlays are safe; never set `overflow` directly.
- Base App WebView: layout uses `dvh`; do not style leftover AppKit dialog siblings (overlays look blank). In Base App, Connect prefers injected/Coinbase over WalletConnect. Wallet connect uses Reown AppKit (`src/config/appkit.ts`) — do **not** enable SIWE/SIWX, email, socials, or `reownAuthentication` (those prompt a sign-message after connect).
- Turbopack chunk errors: `rm -rf .next .turbo && npm run dev`.

## Commands

```bash
npm run dev      # Turbopack dev server
npm run build    # Production build (local / Vercel; not GitHub Actions)
npm run lint     # ESLint (local before push; GitHub CI)
```
