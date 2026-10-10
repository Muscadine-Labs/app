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

- **wagmi must stay on 2.x** (Reown AppKit requirement). **eslint stays on 9.x** until the plugins `eslint-config-next` 16 bundles (`react`, `jsx-a11y`, `import`) accept ESLint 10. Pin **`qr@0.5.5`** in `package.json` overrides (WalletConnect QR `border=0` crash with `qr@0.6.0`). Keep a **root `valtio`** (AppKit/Turbopack `valtio/vanilla` resolve). Keep **`ox` on 0.14.x**. Keep **`allowScripts`** in `package.json` in sync with lockfile versions for `bufferutil`, `keccak`, `unrs-resolver`, `utf-8-validate`, and `@reown/appkit` (npm 11+ install-script allowlist; silences Vercel `allow-scripts-pending`). Keep Dependabot-patched transitive pins in **`overrides`**: `axios`, `hono`, `js-yaml` 4.3.2, `socket.io-parser`, `brace-expansion@1` / `@5`, `browserslist` 4.29.3, `decode-uri-component` 0.5.0.
- **Base only** (chain id 8453). **v1 MetaMorpho removed** — registry and writes are v2 Prime/Frontier only.
- **Builder code** `bc_mwkqu9rd` on all vault txs via `src/lib/builder-code.ts`.
- **v2 writes:** direct ERC-4626 in `transactionUtilsV2.ts`. WETH vaults take and pay WETH. Force exits are vault `multicall` in `force-withdraw-v2.ts`. No Bundler3. No Morpho npm bundler SDK. Do not route deposits through VaultBundles. Do not add a native-ETH wrap or unwrap.
- Registry: `src/lib/vaults.ts` — four curated vaults. Fields include `strategy` (`prime` | `frontier`) and `vaultSymbol` (`mpUSDC`, `mfUSDC`, `mpWETH`, `mpcbBTC`). Explorer uses gate-driven visibility (`useVaultDepositGates`, `vault-access.ts`). Confirm Morpho dead shares (`0x…dEaD`) **before listing**; do not add a runtime RPC check — curated vaults already have them. Retired fee wrappers are not vaults in the app; `RETIRED_WRAPPERS` only maps them to their underlying vault so migrated depositors' history and profit stay one position (see `CLAUDE.md` § Vault registry).
- **Deposit gates:** no allowlist constants. `useVaultDepositGates` reads each vault's own `canSendAssets` on chain as soon as the app and wallet load (true when `sendAssetsGate` is unset). `canReceiveShares` is abated on every registry vault and is not read. Deposits open only on a successful yes; a vault with the send-assets gate unset is open to everyone. Withdraw stays open. Deposits re-check on chain before any approval (`isWalletDepositBlocked`; only a successful no blocks). See `CLAUDE.md` § Deposit gates. Settings is theme only.
- **No “Powered by Morpho” badge** on vault pages (looks tacky). Morpho attribution is the disclaimer: first-connect advisory, NavBar Protocol link, and review/confirm.
- Use `findVaultByAddress` / `isCuratedVaultAddress` from `src/lib/vault-utils.ts` — never infer vault by asset symbol alone. Allocation names and the allocations footer link to Muscadine Analytics (`getVaultAnalyticsUrl`).
- Use `logger` from `src/lib/logger.ts`, not `console.log`.
- **Token display decimals:** UI via `getDisplayFractionDigits` — USDC **6**, cbBTC/ETH/WETH **8**. Prefer raw `bigint` amounts. **Transactions** always use full token decimals (`formatBigIntForInput` — ETH 18, cbBTC 8, USDC 6). Chart axes stay compact.
- **No developer / over-balance bypass mode** — `VaultVersionContext` removed. Explorer filters default to All for strategy/asset; transact blocks amounts over balance.

## Dashboard & positions

- **Wallet strip:** Total / Wallet (liquid) / Vaults USD (`WalletOverview`).
- **Your Vaults** (dashboard): **v2** positions only (registry + external Morpho v2 vaults).
- **Morpho Vaults total** includes **all** user v2 positions from Morpho (`/api/user/morpho-positions`), not only Muscadine registry vaults.
- **External vaults** (not in `vaults.ts`): shown on dashboard / explorer wallet filters with an **External** label, **not clickable**. Navigation uses `isCuratedVaultAddress()`; `/vault/v2/{external}` redirects home.
- **Portfolio chart:** v2 positions via `/api/user/morpho-positions` + `/api/vault/v2/.../position-history` (`aggregatePortfolioHistory` in `portfolio-utils.ts`). Keep zero-share v2 rows for history when `includeEmpty=true`.
- **Morpho positions fetch:** `WalletContext` clears on wallet switch, keeps last snapshot on soft-fail for the same wallet, and ignores stale responses after a switch. Server retries transient Morpho 429/502/503/504; client adds at most one light retry when `retryable`.
- **Earned interest:** `/api/vault/v2/.../earned-interest` + `useVaultEarnedInterest` for all-time (shows **0** when never deposited). My Position header (left column, beside Your Position) shows total earned; past periods and future estimates live in the transact panel Past/Future toggle (`interest-utils.ts`). Use `resolveAssetDecimals` / `getAssetDecimalsForSymbol`.

## Transaction gotchas

- WETH deposits and withdraws are direct ERC-4626. There is no ETH selector and no unwrap.
- Approval and main txs: `waitForSuccessfulReceipt` — a reverted receipt must not continue to the next step.
- Withdraws always simulate the plain exit first; the force planner reads instant liquidity on-chain and never force-deallocates the liquidity route market.
- Deposit caps: Vault V2 `maxDeposit` is always 0, so `deposit-capacity.ts` reads the liquidity adapter's market cap ids (adapter, collateral, market) against `firstTotalAssets`. Input caps at 99.9% of headroom (MAX, and on Deposit press); `depositToVaultV2` re-checks raw headroom before any approval (`DepositCapExceededError`). A failed read never blocks. See `CLAUDE.md` § Deposit caps.
- Force withdraw uses vault `multicall` (`forceDeallocate` + withdraw/redeem) on Blue markets. Do not use Vault V2 `maxWithdraw`. Do not add Bundler3.

## Known gotchas

- Morpho GraphQL invalid fields fail the whole request (HTTP 400).
- New vaults often have TVL before `avgNetApy` or position history is indexed. `stripIncompleteVaultHistoryBuckets` keeps TVL points; `finalizePositionHistory` seeds a short live-position line when history is empty. On an open position, only the current interval's zero buckets are dropped — earlier zeros stay so the portfolio chart does not forward-fill an old balance. Overview hides the APY chart until a positive rate exists.
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
