# AGENTS.md — Muscadine App

Instructions for AI agents working in this repo. Full architecture docs live in `CLAUDE.md` — read it before non-trivial changes.

## Working agreement

1. **Review `TODO.md` at the start of every session.** It is the canonical task list:
   - “TO work on today” → actionable now.
   - “Needs confirmation first” → research or report only; do not implement without user OK.
   - “To work on another day” → backlog; do not start without being asked.
   - Update/remove entries as work completes.
2. **Before every push to GitHub:** run `npm run lint` and `npm run build`; both must pass. Never push to github without users specific permission or order.
4. **Git commits only when the user explicitly asks.**
5. Keep `CLAUDE.md` and this file updated when conventions or architecture knowledge change.

## Key constraints

- **wagmi must stay on 2.x** (RainbowKit 2 requirement). **eslint stays on 9.x**. Pin **`qr@0.5.5`** in `package.json` overrides (WalletConnect QR `border=0` crash with `qr@0.6.0`). Keep a **root `valtio`** (RainbowKit/Turbopack `valtio/vanilla` resolve). Keep **`ox` on 0.14.x**. Keep **`allowScripts`** in `package.json` in sync with lockfile versions for `bufferutil`, `keccak`, `unrs-resolver`, and `utf-8-validate` (npm 11+ install-script allowlist; silences Vercel `allow-scripts-pending`).
- **Base only** (chain id 8453). **v1 MetaMorpho removed** — registry and writes are v2 Prime/Frontier only.
- **Builder code** `bc_mwkqu9rd` on all vault txs via `src/lib/builder-code.ts`.
- **v2 writes:** direct ERC-4626 ABIs in `src/lib/transactionUtilsV2.ts`; multi-step WETH/ETH via Morpho Bundler3 helpers in `src/lib/bundler3.ts` (no Morpho npm bundler SDK).
- Registry: `src/lib/vaults.ts` — fields include `strategy` (`prime` | `frontier`), `vaultSymbol` (e.g. `mpUSDC`, `mfUSDC`).
- Use `findVaultByAddress` / `isCuratedVaultAddress` from `src/lib/vault-utils.ts` — never infer vault by asset symbol alone.
- Use `logger` from `src/lib/logger.ts`, not `console.log`.
- **Token display decimals:** UI via `getDisplayFractionDigits` — USDC **6**, cbBTC/ETH/WETH **8**. Prefer raw `bigint` amounts. **Transactions** always use full token decimals (`formatBigIntForInput` — ETH 18, cbBTC 8, USDC 6). Chart axes stay compact.
- **No developer / over-balance bypass mode** — `VaultVersionContext` removed. Explorer filters default to All for everyone; transact blocks amounts over balance.

## Dashboard & positions

- **Wallet strip:** Total / Wallet (liquid) / Vaults USD (`WalletOverview`).
- **Your Vaults** (dashboard): **v2** positions only (registry + external Morpho v2 vaults).
- **Morpho Vaults total** includes **all** user v2 positions from Morpho (`/api/user/morpho-positions`), not only Muscadine registry vaults.
- **External vaults** (not in `vaults.ts`): shown on dashboard / explorer wallet filters with an **External** label, **not clickable**. Navigation uses `isCuratedVaultAddress()`; `/vault/v2/{external}` redirects home.
- **Portfolio chart:** v2 positions via `/api/user/morpho-positions` + `/api/vault/v2/.../position-history` (`aggregatePortfolioHistory` in `portfolio-utils.ts`). Keep zero-share v2 rows for history when `includeEmpty=true`.
- **Morpho positions fetch:** `WalletContext` clears on wallet switch, keeps last snapshot on soft-fail for the same wallet, and ignores stale responses after a switch. Server retries transient Morpho 429/502/503/504; client adds at most one light retry when `retryable`.
- **Earned interest:** `/api/vault/v2/.../earned-interest` + `useVaultEarnedInterest` for all-time (shows **0** when never deposited). My Position header (left column, beside Your Position) shows total earned; past periods and future estimates live in the transact panel Past/Future toggle (`interest-utils.ts`). Use `resolveAssetDecimals` / `getAssetDecimalsForSymbol`.

## Transaction gotchas (WETH / Bundler3)

- Wrap ETH via Bundler3: fund adapter with empty calldata + `value`, then `wrapNative` with `value: 0` (`wrapNative` is non-payable).
- Withdraw → ETH: approve **shares** to GeneralAdapter, then one Bundler3 multicall (exit to adapter → `unwrapNative`).
- Bundler deposit/withdraw share-price bounds: **0.5%** from on-chain quotes (`BUNDLER_SLIPPAGE_BPS`).
- Resume unwrap only for unwrap-only steps, or after force exit progressed past step 0; never re-force on unwrap failure.
- Force withdraw is vault `multicall` (not Bundler3); ETH unwrap is a follow-up Bundler3 tx. Prefer low-penalty markets; penalty burns shares (withdraw amount = requested).

## Known gotchas

- Morpho GraphQL invalid fields fail the whole request (HTTP 400).
- Morpho public API rate limit (429) / blips (502): `fetchMorphoGraphQL()` retries transient statuses. Positions route returns **503** + `retryable` for rate-limit/transient; other failures **502** without retryable spam.
- Morpho asset USD price: query `price { usd }`; parse via `resolveMorphoAssetPriceUsd()` in `api-utils.ts`.
- Overlay scroll lock: use `useLockPageScroll()` — locks `body` and `[data-app-scroll]` in `AppLayout`. Reference counted, so nested overlays are safe; never set `overflow` directly.
- Base App WebView: layout uses `dvh`; do not style RainbowKit `[role=dialog] ~ div` (leftover overlays look blank). In Base App, Connect prefers injected/Coinbase over WalletConnect.
- Turbopack chunk errors: `rm -rf .next .turbo && npm run dev`.

## Commands

```bash
npm run dev      # Turbopack dev server
npm run build    # Production build (run before pushes)
npm run lint     # ESLint (run before pushes)
```
