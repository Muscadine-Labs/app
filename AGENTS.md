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

- **wagmi must stay on 2.x** (RainbowKit 2 requirement). **eslint stays on 9.x**. Pin **`qr@0.5.5`** in `package.json` overrides (WalletConnect QR `border=0` crash with `qr@0.6.0`).
- **Base only** (chain id 8453). **v1 MetaMorpho removed** — registry and writes are v2 Prime/Frontier only.
- **Builder code** `bc_mwkqu9rd` on all vault txs via `src/lib/builder-code.ts`.
- **v2 writes:** direct ERC-4626 ABIs in `src/lib/transactionUtilsV2.ts`; multi-step WETH/ETH via Morpho Bundler3 helpers in `src/lib/bundler3.ts` (no Morpho npm bundler SDK).
- Registry: `src/lib/vaults.ts` — fields include `strategy` (`prime` | `frontier`), `vaultSymbol` (e.g. `mpUSDC`, `mfUSDC`).
- Use `findVaultByAddress` / `isCuratedVaultAddress` from `src/lib/vault-utils.ts` — never infer vault by asset symbol alone.
- Use `logger` from `src/lib/logger.ts`, not `console.log`.
- **Token display decimals:** UI via `getDisplayFractionDigits` — USDC **6**, cbBTC/ETH/WETH **8**. Prefer raw `bigint` amounts. **Transactions** always use full token decimals (`formatBigIntForInput`, `formatAssetAmountForMax` — ETH 18, cbBTC 8, USDC 6). Chart axes stay compact.
- **No developer / over-balance bypass mode** — `VaultVersionContext` removed. Explorer filters default to All for everyone; transact blocks amounts over balance.

## Dashboard & positions

- **Wallet strip:** Total / Wallet (liquid) / Vaults USD (`WalletOverview`).
- **Tokens panel:** Dynamic — USDC / BTC / ETH only if wallet holds them (or a derivative) or they’re in a vault. Other wallet tokens (AERO, etc.) appear when above ~$0.02 dust. Stocks stay in the Stocks panel.
- **Stocks panel:** tokenized equities (xStocks-style) listed **only when held** in the wallet.
- **Your Vaults** (dashboard): **v2** positions only (registry + external Morpho v2 vaults).
- **Morpho Vaults total** includes **all** user v2 positions from Morpho (`/api/user/morpho-positions`), not only Muscadine registry vaults.
- **External vaults** (not in `vaults.ts`): shown on dashboard / explorer wallet filters, **not clickable** (no detail page; `/vault/v2/{external}` redirects home).
- **Portfolio chart:** v2 positions via `/api/user/morpho-positions` + `/api/vault/v2/.../position-history` (`aggregatePortfolioHistory` in `portfolio-utils.ts`).
- **Earned interest:** `/api/vault/v2/.../earned-interest` + `useVaultEarnedInterest`; shows **0** (not `-`) when user never deposited. Use `resolveAssetDecimals` / `getAssetDecimalsForSymbol`.

## Transaction gotchas (WETH / Bundler3)

- Wrap ETH via Bundler3: fund adapter with empty calldata + `value`, then `wrapNative` with `value: 0` (`wrapNative` is non-payable).
- Withdraw → ETH: approve **shares** to GeneralAdapter, then one Bundler3 multicall (exit to adapter → `unwrapNative`).
- Resume unwrap only when the failed step label includes `unwrap`; never unwrap full wallet WETH from an approval receipt.
- Force withdraw is vault `multicall` (not Bundler3); ETH unwrap is a follow-up Bundler3 tx.

## Known gotchas

- Morpho GraphQL invalid fields fail the whole request (HTTP 400).
- Morpho public API rate limit (429): all server Morpho calls use `fetchMorphoGraphQL()` in `api-utils.ts` (in-memory cache, retries, stale fallback). Routes return 503 with `MORPHO_RATE_LIMIT_BODY` when limited.
- Morpho asset USD price: query `price { usd }`; parse via `resolveMorphoAssetPriceUsd()` in `api-utils.ts`.
- Overlay scroll lock: use `useLockPageScroll()` — locks `body` and `[data-app-scroll]` in `AppLayout`.
- Turbopack chunk errors: `rm -rf .next .turbo && npm run dev`.

## Commands

```bash
npm run dev      # Turbopack dev server
npm run build    # Production build (run before pushes)
npm run lint     # ESLint (run before pushes)
```
