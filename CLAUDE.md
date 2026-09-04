# CLAUDE.md — Muscadine Vaults

Comprehensive context for AI assistants and developers. This is the canonical “extra README” for the repo: architecture, Morpho integration, file map, conventions, and operational notes.

**Product:** **Muscadine Vaults** — web app for curated Morpho vaults on **Base (chain id 8453)** — deposit, withdraw, portfolio view, vault analytics. **v2 Prime and Frontier** vaults for USDC, cbBTC, and WETH. **v1 MetaMorpho removed** from registry and codebase (v2-only writes).

**Version:** `package.json` → `1.3.4`

---

## Working agreement (read first)

- **Review `TODO.md` at the start of every session.** It is the canonical task list: items under “TO work on today” are actionable now; “To work on another day” is backlog. Remove or update entries as work completes.
- **Before every push to GitHub:** run `npm run lint` and `npm run build` locally and make sure both pass. GitHub Actions only lints — never put API keys or a dummy-key build in the workflow. NEVER PUSH TO Github without users explicit permission or order.
- Keep `CLAUDE.md` and `AGENTS.md` in sync when conventions or architecture knowledge change.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Tech stack](#tech-stack)
3. [Architecture overview](#architecture-overview)
4. [Vault registry](#vault-registry)
5. [V1 vs V2 — the most important split](#v1-vs-v2--the-most-important-split)
6. [On-chain transactions](#on-chain-transactions)
7. [Morpho GraphQL & API routes](#morpho-graphql--api-routes)
8. [Morpho npm packages](#morpho-npm-packages)
9. [App routes & pages](#app-routes--pages)
10. [Dashboard & vault explorer UI](#dashboard--vault-explorer-ui)
11. [State & context](#state--context)
12. [Key hooks](#key-hooks)
13. [Directory map](#directory-map)
14. [UI / transaction UX](#ui--transaction-ux)
15. [Wallet & balances](#wallet--balances)
16. [Base App](#base-app)
17. [Configuration & constants](#configuration--constants)
18. [Development](#development)
19. [Dependency constraints](#dependency-constraints)
20. [Code conventions](#code-conventions)
21. [Security](#security)
22. [Future / optional upgrades](#future--optional-upgrades)
23. [Quick reference](#quick-reference)

---

## Quick start

```bash
npm install
cp .env.example .env.local   # or .env — see README
# Set NEXT_PUBLIC_ALCHEMY_API_KEY and NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
npm run dev                  # http://localhost:3000 (Turbopack)
npm run build
npm run lint
```

**Required env vars** (validated in `src/config/wagmi.ts` at startup):

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | **Yes** | Base RPC (Alchemy) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | **Yes** | Reown AppKit / WalletConnect |
| `NEXT_PUBLIC_URL` or `NEXT_PUBLIC_APP_URL` | No (default `https://app.muscadine.xyz`) | Canonical URL + Base Account `appUrl` |

Never commit real keys. `.env.example` documents placeholders.

`package.json` **`allowScripts`** allowlists native/postinstall scripts for `bufferutil`, `keccak`, `unrs-resolver`, and `utf-8-validate` (transitive; WalletConnect `ws` + eslint-next resolver). Keep versions pinned to `package-lock.json`. Local npm 11.4 does not have `npm approve-scripts`; Vercel’s newer npm emits the pending-scripts warning without this field.

`package.json` **`overrides`** also pins patched transitive packages GitHub Dependabot flags (`axios`, `hono`, `js-yaml` 4.x, `socket.io-parser`, `brace-expansion` 1.x/5.x). Do not drop those pins without checking [Dependabot alerts](https://github.com/Muscadine-Labs/app/security).

---

## Tech stack

| Layer | Technology |
|--------|------------|
| Framework | Next.js 16 (App Router) |
| Bundler (dev/build) | Turbopack (`next dev --turbopack`, `next build --turbopack`) |
| UI | React 19, Tailwind CSS 4 |
| Wallet | wagmi **2.x**, Reown AppKit, viem 2 |
| Chain | Base only (`8453`) |
| Server data | Next.js Route Handlers → Morpho GraphQL |
| Client GraphQL | None — Morpho GraphQL is server-only via `fetchMorphoGraphQL()` |
| V2 txs | Direct ERC-4626 via viem (`transactionUtilsV2.ts`); WETH/ETH wrap-unwrap via Morpho **Bundler3** (`bundler3.ts`) |
| Charts | Recharts |
| Analytics | `@vercel/analytics` |
| Base Account SDK | `@base-org/account` |

---

## Architecture overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (client)                         │
│  Reown AppKit / wagmi ──► viem PublicClient + WalletClient       │
│                                                                  │
│  TransactionFlow ──► transactionUtilsV2 (+ Bundler3 for WETH/ETH) │
│  WalletContext ──► /api/user/morpho-positions                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              Next.js Route Handlers (/api/...)                   │
│  POST https://api.morpho.org/graphql  (revalidate ~60s)           │
│  vaultV2ByAddress (v2) only                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Reads:** Morpho GraphQL (server routes via `fetchMorphoGraphQL()`).

**Writes:** User wallet signs transactions built in-app — **not** via GraphQL. Deposits/withdraws are direct ERC-4626 except WETH wrap/unwrap via Bundler3.

---

## Vault registry

Single source of truth: `src/lib/vaults.ts` → `VAULTS` record.

Always resolve version with `getVaultVersion(address)` / `findVaultByAddress()` from `src/lib/vault-utils.ts`. Do not infer v1/v2 from asset symbol alone.

**Default product surface is Morpho fee wrappers** (`kind: 'wrapper'`). They are Vault V2 (`type: FeeWrapper` in GraphQL) immutably allocated to one underlying Morpho Vault V2 via `MorphoVaultV2Adapter`. Query them with `vaultV2ByAddress` like any v2 vault — deposits/withdraws are the same ERC-4626 path.

| Asset | Wrapper (default) | Underlying V2 Prime | Wrapper Frontier | Underlying Frontier |
|-------|-------------------|---------------------|------------------|---------------------|
| USDC | `0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45` (wmpUSDC) | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` (mpUSDC) | `0x54D8417bD21C86A7806b58f5aa2e2E0bB88B856A` (wmfUSDC) | `0x314fD07319ef645bA7D548915CCd91F4788A1839` (mfUSDC) |
| WETH | `0x548653b09b03A69f93B3890c382fE9DcD245cbc4` (wmpWETH) | `0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43` (mpWETH) | — | — |
| cbBTC | `0x0e0a857d2AF1A2d43c82d1FA54766239CAb70147` (wmpcbBTC) | `0x99dcd0D75822BA398F13B2A8852B07c7e137EC70` (mpcbBTC) | — | — |

**Routes:** `/vault/v2/{address}` only (wrappers and underlying are both curated).  
**API:** `/api/vault/v2/{address}/{complete|history|activity|position-history|earned-interest}`

**Vault registry fields:** `symbol` (underlying asset), `vaultSymbol` (share token label), `strategy` (`prime` | `frontier`), `kind` (`wrapper` | `underlying`), `underlyingAddress` (underlying vault on wrappers). Wrapper and underlying of the same product share the display name (e.g. **Muscadine USDC Prime**); the **wrapper** / **underlying** labels appear only when Vault wrappers is off.

**Settings (NavBar, persisted `muscadine-vault-wrappers`):** **Vault wrappers** toggle, default **on** = explorer shows wrappers only, plus any underlying vaults the wallet is deposited in. Toggle **off** = `/vaults` gains a **Vaults** filter (All / Underlying / Wrappers), default **Underlying** (underlying registry vaults plus deposits, including view-only external).

Explorer filters default to **All** (network, strategy, asset). **No v1/v2 version filter** (v1 removed). There is no developer/over-balance bypass mode.

**Dashboard:** Shows Morpho **v2** positions via `/api/user/morpho-positions`; non-curated vaults are read-only on dashboard. Portfolio chart aggregates v2 position-history only.

---

## V2 transactions (only write path)

All vault writes go through **`src/lib/transactionUtilsV2.ts`**. Simple ERC-4626 ops are direct viem calls. Multi-step WETH↔ETH flows use Morpho **Bundler3** + **GeneralAdapter1** (`src/lib/bundler3.ts`).

**Routing:** `TransactionFlow.tsx` → `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` / `forceWithdrawFromVaultV2` (when amount > instant liquidity).

### ERC-4626 reads and UI sources (v2)

| Concern | Source |
|---------|--------|
| **Live Morpho positions** | `/api/user/morpho-positions` → `WalletContext` (not per-vault RPC) |
| **Liquid balances** | Alchemy + wagmi in `WalletContext` |
| **Position history (charts)** | `vaultV2PositionByAddress` → `history` via `/api/vault/v2/.../position-history` |
| **Earned interest** | Morpho `pnl` or activity-based fallback via `/api/vault/v2/.../earned-interest` |
| **Vault TVL / APY** | `vaultV2ByAddress` via `/api/vault/v2/.../complete` and `history` |
| **Headline APY** | Morpho `netApy` (current allocation-weighted; fallbacks `apy` / `avgNetApy` / `avgNetApyExcludingRewards`) |
| **Liquidity in UI** | GraphQL `liquidity` / `liquidityUsd`, not `totalAssets` |

Share tokens use **18 decimals**; underlying assets use registry decimals (USDC **6**, cbBTC **8**, WETH **18**).

---

## On-chain transactions (v2)

### `src/lib/transactionUtilsV2.ts`

Direct ERC-4626 for deposit/withdraw/redeem; Morpho Bundler3 only when wrapping or unwrapping ETH.

**Exports:**

| Function | Behavior |
|----------|----------|
| `depositToVaultV2` | Direct ERC-4626 deposit; WETH vault + ETH wrap uses Bundler3 (`fund adapter` → `wrapNative` → optional WETH `transferFrom` → `erc4626Deposit`) |
| `withdrawFromVaultV2` | Direct `withdraw`; → ETH uses Bundler3 (`erc4626Withdraw` to adapter → `unwrapNative`) |
| `redeemFromVaultV2` | Direct `redeem`; → ETH uses Bundler3 (`erc4626Redeem` to adapter → `unwrapNative`) |
| `forceWithdrawFromVaultV2` | Vault `multicall` force-deallocate + withdraw; optional Bundler3 unwrap follow-up |
| `resumeUnwrapWalletWethV2` | Resume Bundler3 unwrap after force→ETH unwrap failure (amount from prior exit receipt logs only) |

**ABIs (in-file):**

- `ERC20_ABI` — `approve`, `allowance`, `balanceOf`, `decimals`
- `ERC4626_ABI` — `asset`, `deposit`, `withdraw`, `redeem`, `previewWithdraw`, `convertToAssets`

### Morpho Bundler3 (`src/lib/bundler3.ts`)

Base Bundler3 + GeneralAdapter1. Used for ETH wrap deposits and WETH→ETH unwrap. Adapter ERC-4626 calls use share-price bounds from on-chain quotes with **0.03%** slippage (`BUNDLER_SLIPPAGE_BPS`). Plain USDC/cbBTC/WETH deposits call the vault directly — no extra adapter approval.

| Constant | Address (Base) |
|----------|----------------|
| `BUNDLER3_ADDRESS` | `0x6BFd8137e702540E7A42B74178A4a49Ba43920C4` |
| `GENERAL_ADAPTER_ADDRESS` | `0xb98c948CFA24072e58935BC004a8A7b376AE746A` |

**Rules:**

- ETH fund step must be **empty calldata + value** (adapter `receive()`). `wrapNative` is **non-payable** — never attach value to the wrap call.
- Deposit with wrap: `fund → wrapNative → optional erc20TransferFrom(WETH) → erc4626Deposit`.
- Withdraw/redeem → ETH: approve vault **shares** to GeneralAdapter → `erc4626Withdraw|Redeem` (receiver=adapter) → `unwrapNative(max, user)`.
- Resume unwrap: only when the failed step label includes `unwrap`; never fall back to full wallet WETH `balanceOf`.

**WETH vaults and WETH wrappers** (vault `asset()` is `BASE_WETH_ADDRESS`):

- Deposit `preferredAsset`: `'ETH' | 'WETH' | 'ALL'` (wrap ETH, use WETH only, or combine). **Default is WETH.** Gas reserve `ETH_GAS_RESERVE` (`0.0001 ETH`) left in wallet when wrapping.
- Withdraw `preferredAsset`: `'ETH' | 'WETH'` (not `'ALL'`) — Bundler3 unwrap when ETH selected.
- USDC / cbBTC vaults never use Bundler3.

**Force withdraw** (`src/lib/force-withdraw-v2.ts`): when requested assets exceed instant liquidity, plan `forceDeallocate` × N + `withdraw` or **`redeem` (MAX)** in vault `multicall` — same route as Morpho SDK `forceWithdraw` / `forceRedeem`. Works on **all** v2 vaults: Blue market adapters (`abi.encode(marketParams)`) and fee-wrapper / VaultV1-style adapters (`data = 0x`, inner ERC-4626 `maxWithdraw`). Warning modal shows estimated penalty, risks, **Force withdraw**, and **Open vault on Morpho**. ETH unwrap (if selected) is a **second** Bundler3 tx after the vault exit. If adapters lack free cash, force plan is unavailable — user must reduce amount to instant liquidity, wait, or use Morpho.

This is **not** in-kind redemption. In-kind (`vault.inKindRedeem` → VaultExitBundlesV1 `vaultExitBundlesV1InKindRedemptionVaultV2`) burns shares and transfers Morpho Blue supply positions to the user. Not implemented. Do not swap force withdraw for `vaultExitBundlesV1ForceWithdrawVaultV2` (bundle helper with referral fee / minSharePrice); Morpho’s documented cash path remains vault `multicall`.

**Approvals:**

- Direct deposit: spender is the **vault**.
- Bundler3 wrap deposit with wallet WETH, or withdraw→ETH: spender is **GeneralAdapter1** (WETH or vault shares). ETH-only wrap needs no ERC-20 approval.
- USDC-style reset-to-zero may run before a new approval when needed.

**Progress:** `TransactionProgressCallback` — `approving` for approvals, `confirming` for main/Bundler3 tx (do not treat approval hash as final success).

**Routing:** `TransactionFlow.tsx` calls v2 helpers only (`getVaultVersion` always returns `'v2'`).

### Shared transaction utilities — `src/lib/transactionUtils.ts`

- `formatTransactionError`, `isCancellationError`
- Used by `TransactionFlow` error handling

### Transaction orchestration — `TransactionFlow.tsx`

v2-only: `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` / `forceWithdrawFromVaultV2`. Redeem when amount ≈ max via `shouldUseWithdrawAll` (unless a force plan is active).

**Max withdraw detection:** Compares entered amount to `convertToAssets(fullShares)` via **bigint** `parseUnits` with a tight tolerance (~1 unit at ≤8 dp, or 0.001% of max) → uses redeem path / force redeem.

**Liquidity warning:** Before withdraw, if amount > instant liquidity, show `WithdrawLiquidityWarningModal` (force path or Morpho link).

---

## Morpho GraphQL & API routes

**Endpoint:** `https://api.morpho.org/graphql`  
**Docs:** https://docs.morpho.org/tools/offchain/api/morpho-vaults/

### V2 complete route (`src/app/api/vault/v2/[address]/complete/route.ts`)

Query root: `vaultV2ByAddress(address, chainId)`.

Notable fields: `asset`, `totalAssets`, `totalSupply`, `liquidity`, `liquidityUsd`, `idleAssetsUsd`, `avgNetApy`, `avgNetApyExcludingRewards`, `maxApy`, `adapters`, `rewards`, `warnings`, etc. Response is normalized toward v1-shaped JSON (`vaultByAddress` shape) for shared UI. Headline APY maps from Morpho **`netApy`** (with fallbacks), matching the Morpho deposit widget.

### V2 history route (`src/app/api/vault/v2/[address]/history/route.ts`)

Query root: `vaultV2ByAddress` → `historicalState`. APY series uses **`avgNetApy` only** (`avgNetApyExcludingRewards` is not on the history type). Maps to `apy` / `netApy` in the JSON response (percent × 100).

### Position history (v2)

- **V1:** `vaultPosition` + `historicalState.{assets,assetsUsd,shares}`
- **V2:** `vaultV2PositionByAddress` + `history.{assets,assetsUsd,shares}`; raw `assets` / `shares` scaled by asset decimals / 1e18 in the route handler

Both return `currentPosition` + `history[]` with `{ timestamp, assets, assetsUsd, shares }`.

### Incomplete Morpho timeseries buckets

Morpho often returns a **trailing interval** (current hour/day) with **zeros** for TVL and/or position while the in-progress bucket is empty. That makes charts dip to zero on the last point.

**Fix:** `stripIncompleteVaultHistoryBuckets` (vault `history` routes) and `finalizePositionHistory` (`position-history` routes) in `src/lib/api-utils.ts` — applied on v2 route responses before JSON is returned.

Brand-new vaults (fee wrappers) often have TVL/share-price points before Morpho indexes `avgNetApy`. `stripIncompleteVaultHistoryBuckets` keeps those TVL points instead of emptying the series. Overview still hides the APY chart until a positive `apy` exists, and falls back to the hourly 30d series when daily `period=all` is empty.

**`finalizePositionHistory` (position-history only):** uses the live `currentPosition` to disambiguate trailing zeros:

- **Position open** (shares/assets > 0): trailing zero buckets are the in-progress interval → stripped (`stripIncompletePositionHistoryBuckets`). If Morpho has not indexed any history yet, seed a short flat line from the live position so Your Position is not blank.
- **Position closed** (fully withdrawn): trailing zeros are real → kept. If Morpho's stale v1 history still ends at a **pre-withdrawal value**, a **zero point** is appended one bucket after the last point, so the dashboard's forward-fill aggregation drops to zero instead of being stuck at the last held amount (the "portfolio stuck at old v1 balance" bug).

### Morpho GraphQL schema changes (2025–2026)

If `complete` routes return **HTTP 400**, validate queries against `https://api.morpho.org/graphql` — invalid fields fail the whole request.

| Removed / renamed | Use instead |
|-------------------|-------------|
| `Asset.priceUsd` | `price { usd }` — use `resolveMorphoAssetPriceUsd()` in `api-utils.ts` |
| `VaultStateReward.yearlySupplyTokens` | Removed — query `supplyApr` only |
| `whitelisted` on Vault / VaultV2 | `listed` (map to `whitelisted` in API responses for UI) |
| `state.sharePrice` (v1 VaultState) | Compute from `totalAssets` / `totalSupply` |
| `state.avgApy` (v1) | `avgNetApy` or `apy` |
| `metadata.curators` (v1) | Removed — omit from query |
| `market.uniqueKey` (v1) | `id` (alias as `uniqueKey: id` in query) |
| `historicalState.sharePrice` (v1 VaultHistory) | Removed — derive from `totalAssets` / `totalSupply` in route handler |

**Positions in the UI** use `/api/user/morpho-positions` for Morpho holdings; vault metadata from `/api/vault/v2/.../complete`. Broken GraphQL breaks explorer columns; `WalletContext` falls back to registry metadata when complete fails.

### Caching

`next: { revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS }` (60 seconds by default in `constants.ts`) + cache tags like `vault-{address}-{chainId}`.

### Client data

Morpho GraphQL is **server-only** (`fetchMorphoGraphQL()` in route handlers). There is no client Apollo/GraphQL client.

---

## Morpho npm packages

**Removed from `package.json`:** `@morpho-org/*` bundler/simulation SDKs (v1 path deleted), unused Apollo Client / `graphql`. Morpho reads use **server `fetch`** to `api.morpho.org`.

**Not a dependency:** `@morpho-org/morpho-sdk` (`viem` peer only). Optional for Permit/Permit2 and in-kind redemption. Cash force-withdraw already matches SDK `forceWithdraw` / `forceRedeem`.

---

## App routes & pages

| Path | Description |
|------|-------------|
| `/` | **Dashboard** — compact `WalletOverview` strip, portfolio chart, Your Vaults |
| `/vaults` | **Vault explorer** — filter bar + table of registry vaults |
| `/transact` | **Removed** — 308 redirect to `/vaults`. Deposit/withdraw is the inline `VaultTransactPanel` on vault **My Position**. |
| `/vault/v2/[address]` | V2 vault detail |
| `/api/prices` | Price proxy/cache |
| `/api/user/morpho-positions` | User Morpho v2 positions |
| `/api/vault/v2/...` | V2 Morpho GraphQL proxies |

**NavBar:** Dashboard → `/`, Vaults → `/vaults`. Settings: theme (light/dark/auto) and **Vault wrappers** toggle (persisted). Right sidebar (`LearnContent`) is Q&A links to Morpho docs (protocol, Vault V2, [fee wrapper](https://docs.morpho.org/developers/earn/concepts/fee-wrapper/), curator, Blue, Midnight) and [self-custody](https://muscadine.xyz/self-custody).

**App title:** metadata in `layout.tsx` uses **Muscadine Vaults** (`APP_NAME` in `src/lib/base-app.ts`) so Base.dev / Reown AppKit / WalletConnect match.

---

## Dashboard & vault explorer UI

### Dashboard (`/` — `src/app/page.tsx`)

Adaptive layout (content-sized panels; empty sections omitted):

| Area | Component | Behavior |
|------|-----------|----------|
| Wallet | `WalletOverview` | Full $ amounts; strip width measured live |
| Chart | `PortfolioPositionChart` | Under wallet; ~300–380px height |
| Side | Your Vaults | Vaults when held |

**Responsive wallet / vaults (`useWalletStripNeedsFullWidth`):** On desktop (`min-[1000px]`), compares wallet strip intrinsic width to half the dashboard. If it fits → vaults align with wallet; if too wide (big $ / narrow window) → wallet spans full width and vaults drop to align with the chart. Mobile always stacks (wallet → chart → vaults). Hysteresis avoids flicker on resize.

**Important:** Portfolio chart includes **v2** positions from the API; **Your Vaults** is **v2-only**.

- **Your Vaults** lists v2 deposits only (`position.version === 'v2'`), sorted by USD. External (non-curated) vaults are shown but **not clickable** (no `/vault/v2/...` detail page). Hidden when empty. **wrapper** / **underlying** pills appear only when Vault wrappers is **off**.
- **Layout:** Desktop uses two independent columns. Your Vaults sits beside the chart. Wide wallet still uses `wallet|wallet / chart|side`. Below 1000px stacks wallet → chart → Vaults.
- **Portfolio chart** (`PortfolioPositionChart.tsx`):
  1. Discovers vaults via `/api/user/morpho-positions?includeEmpty=true`.
  2. **`aggregatePortfolioHistory()`** in `portfolio-utils.ts` — forward-fill and sum USD.
  - **Current holdings** in `WalletOverview` / Your Vaults from **`WalletContext`** (`/api/user/morpho-positions`).
- Preloads vault API data for deposited vaults via `useVaultListPreloader`.
- **Position display:** `formatPositionUsd` / `formatPositionTokenAmount` in `formatter.ts` — USDC **6**, cbBTC/ETH/WETH **8**. Transactions use full chain decimals via `formatBigIntForInput`. Chart axes stay compact (2/6).

### Vault explorer (`/vaults` — `src/app/vaults/page.tsx`)

`VaultExplorer` = `VaultExplorerFilters` + `VaultExplorerTable`.

**Filters** (`VaultExplorerFilters.tsx`) — compact `text-xs` controls:

| Filter | Options | Notes |
|--------|---------|-------|
| Network | All, Base | Default **All**; `base` filters `chainId === 8453` |
| Strategy | All, Prime, Frontier | Default **All** (shows Prime + Frontier) |
| Asset | All, USDC, cbBTC, WETH | Local filter state. |
| Vaults | All, Underlying, Wrappers | Shown only when Vault wrappers is **off**. Default **Underlying**. Wrapper / underlying names get a short **wrapper** or **underlying** pill in this mode (explorer, dashboard, vault hero). |
| Scope | Deposits + whitelisted, In wallet, **Whitelisted** | Default **Deposits + whitelisted**. Wallet modes can list external deposits as **External** (not clickable). |

**Table columns** (`VaultExplorerTable.tsx`): Vault, **Your Position**, **Earned Interest**, **APY / TVL** (compact layout). **Whitelisted** rows navigate to `/vault/v2/{address}`; external rows are display-only.

**Vault list sort order** (`sortVaultsForDisplay`): (1) position USD high → low, (2) TVL high → low, (3) name.

**Earned interest:** `useVaultEarnedInterest` for curated vaults; shows **0** when never deposited.

### Vault detail (`/vault/v2/[address]`)

Whitelisted registry vaults only — unknown / external addresses redirect home. Deposit/Withdraw is an inline `VaultTransactPanel` top-aligned with Your Position + Earned Interest (chart under those totals). Below 1000px: totals → chart → panel. Stats box: Network, APY, Past/Future rewards (no duplicate position or all-time earned). Past is the default when the user has a vault position; Future is the default when they do not. WETH vault deposits default to WETH (ETH and ETH+WETH remain selectable). Mobile sticky Deposit/Withdraw on Overview jumps to My Position. Tab switches away from My Position are blocked while a tx is in preview/signing.

### Vault detail charts (`VaultOverview.tsx`)

Chart tabs (order): **APY** → **Total Deposits** → **Share Price** → **Allocations**. **Total Deposits** and **Share Price** support USD / token toggle. Axis labels and tooltips use full values with 2 decimals (`formatCurrency` / `formatAssetAmount`). Stat cards use `formatSmartCurrency`.

**Allocations:** Wrapper vaults show **{amount} to {underlying vault}** as a group header, then the underlying vault’s Morpho Blue markets underneath (same columns as underlying vaults: **Market** / Type / Allocated / APY / Liquidity / **Market size**). Nested allocated amounts are the wrapper’s share of each underlying-vault market. Name and footer still link to [Muscadine Analytics](https://analytics.muscadine.xyz/vault/v2/{address}) (`getVaultAnalyticsUrl`). Underlying vaults keep a flat market table and Morpho market URLs.

---

## State & context

Provider tree (`src/app/Providers.tsx`):

`ErrorBoundary` → `WagmiProvider` → `QueryClient` → `ThemeProvider` → `VaultSettingsProvider` → `AdvisoryAgreementProvider` → `ToastProvider` → `WalletProvider` → `VaultDataProvider` → `TransactionProvider` (Reown AppKit initialized via `createAppKit` in `src/config/appkit.ts`; no SIWE/SIWX)

| Context | File | Role |
|---------|------|------|
| `WalletContext` | `contexts/WalletContext.tsx` | Alchemy liquid balances; Morpho positions via `/api/user/morpho-positions`; refresh after txs |
| `VaultDataContext` | `contexts/VaultDataContext.tsx` | Cached vault metadata from `/api/vault/.../complete` |
| `TransactionContext` | `contexts/TransactionContext.tsx` | Vault transact modal: from/to accounts, amount, status, `preferredAsset` |
| `PriceContext` | `contexts/PriceContext.tsx` | Asset USD prices |
| `ToastContext` | `contexts/ToastContext.tsx` | Toasts |
| `ThemeContext` | `contexts/ThemeContext.tsx` | Light/dark |
| `VaultSettingsContext` | `contexts/VaultSettingsContext.tsx` | Vault wrappers toggle (localStorage) |
| `AdvisoryAgreementContext` | `contexts/AdvisoryAgreementContext.tsx` | Legal modal gating |

### Advisory agreement (`AdvisoryAgreementModal.tsx`)

Shown before wallet connect (`ConnectButton` → `AdvisoryAgreementProvider`). Copy is **non-custodial / risk curation only** — not discretionary management or investment advice.

**Legal links (canonical URLs):**

| Label | URL |
|-------|-----|
| Terms of Use | https://muscadine.xyz/terms |
| Legal Disclaimer | https://muscadine.xyz/legal |
| Morpho’s Disclaimer | https://morpho.org/disclaimers |
| Privacy Policy | https://muscadine.xyz/privacy |
| Risk Framework | https://muscadine.xyz/risk |
| U.S. economic sanctions (checkbox) | https://ofac.treasury.gov/sanctions-programs-and-country-information |

Same Risk Framework / Morpho’s Disclaimer links appear in **NavBar** Muscadine dropdown (Protocol section, with Terms / Legal / Privacy).

**Morpho Earn UX:** first-interaction copy includes Morpho’s required disclosure (Muscadine Terms + Morpho’s Disclaimer). Same Morpho Disclaimer link is in the NavBar Protocol menu and on review/confirm. Do **not** add a “Powered by Morpho” badge on vault hero, the transact panel, or review — it reads as tacky next to the product UI; the disclaimer links cover attribution.

**Dead shares:** curated vaults already mint inflation-protection shares to `0x…dEaD`. Confirm that **when adding a vault** to `vaults.ts`. Do not RPC-check dead-share balances at runtime (no Alchemy call on `/complete` or elsewhere).

**Re-acceptance:** `TERMS_VERSION` in `AdvisoryAgreementContext.tsx` (currently **`2.1.0`**) — bump when legal copy changes; stored in localStorage as `advisory-agreement-version` alongside `advisory-agreement-accepted`.

---

## Key hooks

| Hook | File | Purpose |
|------|------|---------|
| `useVaultEarnedInterest` | `hooks/useVaultEarnedInterest.ts` | All-time earned interest for curated vaults |
| `useClearStuckWalletUi` | `hooks/useClearStuckWalletUi.ts` | Clear leftover wallet overlays in Base App WebView |
| `useVaultDataFetch` | `hooks/useVaultDataFetch.ts` | Fetch/cache vault API data, list preloader |
| `useClientOnly` | `hooks/useClientOnly.ts` | `useIsClient()`, `useUnixTimestamp()` — SSR-safe patterns |

---

## Directory map

```text
src/
  app/
    page.tsx              # Dashboard
    vaults/page.tsx       # Vault explorer
  components/
    features/
      vault/              # VaultExplorer*, VaultOverview, VaultPosition, VaultHistory, VaultTransactPanel, VaultEarningsBreakdown, …
      wallet/             # WalletOverview, PortfolioPositionChart, ConnectButton, …
      transactions/       # TransactionFlow, confirmation UI
      learn/              # LearnContent (sidebar Q&A → Morpho docs + self-custody)
    layout/               # AppLayout, NavBar, RightSidebar
    ui/                   # Button, Modal, Toast, Skeleton, Icon
    common/               # ErrorBoundary, CopiableAddress
  config/
    wagmi.ts              # Base + Alchemy + Reown WagmiAdapter
    appkit.ts             # createAppKit (no SIWE/SIWX; EIP-6963 + featured Base/Rabby/Phantom)
    navigation.tsx        # Nav links (Dashboard, Vaults)
  contexts/               # See table above
  hooks/
  lib/
    base-app.ts           # APP_NAME, BASE_APP_ID, Base App WebView detect
    portfolio-utils.ts    # ★ aggregatePortfolioHistory (dashboard)
    api-utils.ts          # Period/interval helpers; strip incomplete Morpho timeseries tails
    transactionUtilsV2.ts # ★ V2 on-chain (ERC-4626 + Bundler3 for WETH/ETH)
    bundler3.ts # Morpho Bundler3 helpers (ETH wrap/unwrap + ERC-4626)
    transactionUtils.ts   # Errors, shared tx helpers
    vaults.ts             # ★ Vault registry (wrappers + underlying v2 Prime/Frontier)
    vault-utils.ts        # Routes, sortVaultsForDisplay, resolvePositionAssetsUsd, isCuratedVaultAddress
    interest-utils.ts     # Earned interest from activity; period + projected estimates
    asset-decimals.ts     # Morpho amount normalization
    constants.ts          # Chain, WETH, cache TTLs, GENERAL_ADAPTER
    abis.ts               # Shared ERC20 balance + ERC4626 convertToAssets
    formatter.ts          # formatCurrency, formatSmartCurrency, formatAssetAmount, …
    logger.ts             # Structured logging
  types/
    vault.ts              # Vault, MorphoVaultData, account types
    transactions.ts       # Progress step types
    api.ts                # Alchemy / API response types
```

---

## UI / transaction UX

**Statuses:** `idle` → `preview` → `signing` | `approving` → `confirming` → `success` | `error`

**Progress steps** (`types/transactions.ts`): `signing`, `approving`, `confirming`.

**Rules:**

- Approval txs use `approving`; only the main vault op should set `confirming` with the hash users care about.
- After success, balances refresh via `refreshBalancesWithPolling` in `TransactionFlow`.

**Vault transact panel** (`VaultTransactPanel.tsx` + `useScopedVaultTransaction`): amount entry stays inline on My Position. After Deposit/Withdraw, review/confirm is the same popup (`Modal` + `TransactionFlow`) as before so addresses and steps are readable. Amounts over balance block the CTA. `/transact` redirects to `/vaults`.

**Transact tabs:** Tab highlight uses `activeTab` (user selection). `effectiveActiveTab` infers deposit vs withdraw from From/To when both accounts are set (WETH prefs, max amount). `handleTabChange` resets accounts per tab; do not no-op on `tab === activeTab` alone — use `accountsMatchTransactionTab()` so mismatched From/To does not block clicks.

**Portfolio position history:** Per-vault API at `/api/vault/v2/{address}/position-history` (tails stripped server-side). Dashboard runs **`aggregatePortfolioHistory`**; single-vault charts use `VaultPosition.tsx`.

**Formatting conventions:**

- Table/explorer USD pills: `formatSmartCurrency(..., { alwaysTwoDecimals: true })` for compact TVL/deposits.
- Vault detail **Total Deposits chart** (when toggled): `formatCurrency` / 2-decimal token amounts on axis + tooltip — not abbreviated thousands.

---

## Wallet & balances

`WalletContext`:

- Native ETH + tokens: USDC, cbBTC, WETH, cbETH, wstETH (`TOKEN_ADDRESSES` on Base) via Alchemy
- **Morpho positions:** `/api/user/morpho-positions` (v2); metadata from `/api/vault/v2/.../complete`
- `refreshBalances`, `refreshBalancesWithPolling` after transactions

---

## Base App

Standard web app on Base — no Farcaster manifest or mini-app SDK. Register on [base.dev](https://base.dev) with primary URL **`https://app.muscadine.xyz`** (no separate `miniapp.*` subdomain). Listing **name** should be **Muscadine Vaults** so in-app search matches by name, not only the URL.

| Piece | Location |
|-------|----------|
| `APP_NAME` / `BASE_APP_ID` | `src/lib/base-app.ts` |
| `base:app_id` meta tag | `layout.tsx` `metadata.other` **and** explicit `<meta name="base:app_id">` (id `6925cdc1547fca5d08131407`) |
| `appUrl` / `appIcon` for Base Account UI | `getAppUrl()` + `/favicon.png` in wagmi config |
| Builder code (ERC-8021) | `src/lib/builder-code.ts` → `transactionUtilsV2.ts` |
| Base App WebView | `isBaseAppWebView()` — Connect uses injected/Coinbase, not WalletConnect. Layout `dvh`. Do not CSS-elevate leftover AppKit dialog siblings. |

Optional later: [Base Notifications API](https://docs.base.org/apps/technical-guides/base-notifications) (wallet-address based; no Farcaster).

---

## Configuration & constants

`src/lib/constants.ts`:

- `BASE_CHAIN_ID = 8453`
- `BASE_WETH_ADDRESS` — Base canonical WETH
- `GENERAL_ADAPTER_ADDRESS` — Morpho GeneralAdapter1 on Base (Bundler3 wrap/unwrap + ERC-4626)
- Cache TTLs: vault client + Morpho in-memory **60s**; prices 10m; activity 1m
- Morpho GraphQL: `MORPHO_GRAPHQL_URL`, `MORPHO_GRAPHQL_REVALIDATE_SECONDS`, fetch timeout/retries, preload batch size — all Morpho calls go through `fetchMorphoGraphQL()` in `api-utils.ts`

`next.config.ts`:

- Webpack/Turbopack aliases for `wagmi` and `@tanstack/react-query` (singleton React Query context)
- Externals: `pino-pretty`, `lokijs`, `encoding`
- Redirect: `/transact` → `/vaults` (308)

---

## Development

### Commands

```bash
npm run dev      # Turbopack dev server
npm run build
npm run lint
npm start        # Production server
```

**CI** (`.github/workflows/ci.yml`, Node 24): `npm run lint` only. Do not run `npm run build` on GitHub — `wagmi.ts` requires `NEXT_PUBLIC_ALCHEMY_API_KEY` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` at module load, and those keys stay in local `.env` / Vercel, never in the repo or GitHub Actions. Production build is Vercel. Confirm Vercel Node is 24 (`package.json` `engines`).

### Turbopack chunk error

If you see `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` after mixing `build` and `dev`:

```bash
rm -rf .next .turbo && npm run dev
```

### Adding a vault

1. Add to `src/lib/vaults.ts` with correct `version`, `kind` (`wrapper` | `underlying`), and `underlyingAddress` on wrappers.
2. Confirm Morpho GraphQL returns it (`vaultV2ByAddress`). Fee wrappers use `type: FeeWrapper` and a `MorphoVaultV2Adapter` — they are still queried as v2 vaults.
3. Confirm the vault has Morpho dead-share inflation protection (minted to `0x…dEaD`) before listing — we do not RPC-check this at runtime.
4. v2 writes require no change in `transactionUtilsV2` if address is passed dynamically — registry drives UI labels and routing.

### Changing v2 transaction behavior

Edit **`src/lib/transactionUtilsV2.ts`** and/or **`src/lib/bundler3.ts`**. Plain deposits are direct ERC-4626; Bundler3 is wrap/unwrap only. Test approve → deposit and withdraw/redeem on Base with small amounts; for ETH paths confirm Bundler3 multicall.

---

## Dependency constraints

Do not bump without checking compatibility:

| Package | Constraint |
|---------|------------|
| `wagmi` | Stay on **2.x** — Reown AppKit requirement |
| `eslint` | Stay on **9.x** (`eslint@^9.39`) — `eslint-config-next` breaks on 10 |
| `ox` | Stay on **0.14.x** — `ox@1` is a breaking rewrite; used for ERC-8021 builder codes |
| `valtio` | Keep a **root** `valtio` (2.x) — Reown AppKit / WalletConnect must resolve `valtio/vanilla` under Turbopack |
| `@morpho-org/*-wagmi` 4.x | Often requires wagmi 3 |

---

## Code conventions

- TypeScript, `@/` → `src/`
- `'use client'` on interactive / wagmi components
- Minimize scope; keep v1 and v2 paths separate
- Use `logger` from `lib/logger.ts` instead of ad-hoc `console.log`. `error` / `warn` always log; `info` / `debug` are development-only.
- Resolve vault version from `vaults.ts` / `getVaultVersion`
- **Git commits:** only when the user explicitly asks
- Match existing style in touched files; avoid drive-by refactors

---

## Security

- See `SECURITY.md` — report issues privately to muscadinelabs@gmail.com
- Users sign all transactions in their wallet
- No private keys in the repo; env vars for RPC and WalletConnect only (local `.env` / Vercel — never GitHub Actions)

---

## Future / optional upgrades

### Product / registry (planned)

1. **Multi-chain vaults** — Extend beyond Base to **Ethereum** and **Hyperliquid**: multi-chain `VAULTS` entries, RPC/wagmi chains, Morpho GraphQL `chainId` on API routes, explorer Network filter (today only Base is real; “All” is forward-compatible).
### Technical (optional)

3. **`@morpho-org/morpho-sdk` for v2** — optional for Permit/Permit2 and **in-kind redemption** (`inKindRedeem`). Peer dep is viem only; does not require wagmi 3.
4. **`supportSignature: true`** — Permit/Permit2 to skip extra approval txs.
5. **V2 vault-to-vault transfers** — Not implemented; would need withdraw + deposit coordination.
6. **In-kind redemption UI** — When force withdraw cannot cover (no free market cash), preview and transfer Blue supply positions via SDK `inKindRedeem`. Do not replace force withdraw with `vaultExitBundlesV1ForceWithdrawVaultV2`.

**Morpho doc indexes for LLMs:**

- https://docs.morpho.org/llms.txt  
- https://docs.morpho.org/llms-full.txt  

---

## Quick reference

| Task | Where to look |
|------|----------------|
| Dashboard layout | `src/app/page.tsx` |
| Portfolio history chart | `PortfolioPositionChart.tsx`, `portfolio-utils.ts` (`aggregatePortfolioHistory`) |
| Morpho timeseries tail fix | `api-utils.ts` (`stripIncomplete*`, `finalizePositionHistory`), used in vault `history` + `position-history` routes |
| Position table formatting | `formatter.ts` (`formatPositionUsd`, `formatPositionTokenAmount`) |
| Vault explorer page | `src/app/vaults/page.tsx`, `VaultExplorer*.tsx` |
| V2 deposit/withdraw/redeem | `src/lib/transactionUtilsV2.ts` |
| Bundler3 WETH/ETH helpers | `src/lib/bundler3.ts` |
| Force withdraw plan | `src/lib/force-withdraw-v2.ts` |
| Transaction orchestration | `src/components/features/transactions/TransactionFlow.tsx` |
| Vault addresses | `src/lib/vaults.ts` |
| Vault sort / routing | `src/lib/vault-utils.ts` (`sortVaultsForDisplay`, `getVaultRoute`) |
| Earned interest API | `src/app/api/vault/v2/[address]/earned-interest/route.ts` |
| Morpho positions API | `src/app/api/user/morpho-positions/route.ts` |
| Advisory agreement modal | `src/components/features/wallet/AdvisoryAgreementModal.tsx` |
| Morpho GraphQL / fetch helper | `src/lib/api-utils.ts` (`fetchMorphoGraphQL`) |
| V2 vault API data | `src/app/api/vault/v2/[address]/complete/route.ts` |
| Transact state | `src/contexts/TransactionContext.tsx` |
| Total Deposits chart formatting | `src/components/features/vault/VaultOverview.tsx` |
| User-facing README | `README.md` |
