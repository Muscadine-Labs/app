# CLAUDE.md — Muscadine App

Comprehensive context for AI assistants and developers. This is the canonical “extra README” for the repo: architecture, Morpho integration, file map, conventions, and operational notes.

**Product:** Web app for Muscadine vaults on **Base (chain id 8453)** — deposit, withdraw, portfolio view, vault analytics. **v2 Prime and Frontier** vaults for USDC, cbBTC, and WETH. **v1 MetaMorpho removed** from registry and codebase (v2-only writes).

**Version:** `package.json` → `1.1.5`

---

## Working agreement (read first)

- **Review `TODO.md` at the start of every session.** It is the canonical task list: items under “TO work on today” are actionable now; “To work on another day” is backlog. Remove or update entries as work completes.
- **Before every push to GitHub:** run `npm run lint` and `npm run build` and make sure both pass. NEVER PUSH TO Github without users explicit permission or order.
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
16. [Farcaster mini app](#farcaster-mini-app)
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

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Base RPC (Alchemy) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | RainbowKit / WalletConnect |

Never commit real keys. `.env.example` documents placeholders.

---

## Tech stack

| Layer | Technology |
|--------|------------|
| Framework | Next.js 16 (App Router) |
| Bundler (dev/build) | Turbopack (`next dev --turbopack`, `next build --turbopack`) |
| UI | React 19, Tailwind CSS 4 |
| Wallet | wagmi **2.x**, RainbowKit 2, viem 2 |
| Chain | Base only (`8453`) |
| Server data | Next.js Route Handlers → Morpho GraphQL |
| Client GraphQL | Apollo Client → `https://api.morpho.org/graphql` |
| V1 txs | `@morpho-org/bundler-sdk-viem` + simulation |
| V2 txs | **Direct ERC-4626 + ERC-20 ABIs** via viem (`transactionUtilsV2.ts`) |
| Charts | Recharts |
| Analytics | `@vercel/analytics` |
| Mini app | `@farcaster/miniapp-sdk` |

---

## Architecture overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (client)                         │
│  RainbowKit / wagmi ──► viem PublicClient + WalletClient         │
│                                                                  │
│  TransactionFlow ──► transactionUtilsV2 (ERC-4626 ABI)             │
│  WalletContext ──► /api/user/morpho-positions                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              Next.js Route Handlers (/api/...)                   │
│  POST https://api.morpho.org/graphql  (revalidate ~5 min)         │
│  vaultV2ByAddress (v2)  |  v1 position-history (backfill only)   │
└─────────────────────────────────────────────────────────────────┘
```

**Reads:** Morpho GraphQL (server routes + some client Apollo usage).

**Writes:** User wallet signs transactions built in-app — **not** via GraphQL.

---

## Vault registry

Single source of truth: `src/lib/vaults.ts` → `VAULTS` record.

Always resolve version with `getVaultVersion(address)` / `findVaultByAddress()` from `src/lib/vault-utils.ts`. Do not infer v1/v2 from asset symbol alone.

| Asset | V2 Prime | V2 Frontier |
|-------|----------|-------------|
| USDC | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` (mpUSDC) | `0x314fD07319ef645bA7D548915CCd91F4788A1839` (mfUSDC) |
| cbBTC | `0x99dcd0D75822BA398F13B2A8852B07c7e137EC70` (mpcbBTC) | — |
| WETH | `0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43` (mpWETH) | — |

**Routes:** `/vault/v2/{address}` only  
**API:** `/api/vault/v2/{address}/{complete|history|activity|position-history|earned-interest}`

**Vault registry fields:** `symbol` (underlying asset), `vaultSymbol` (share token label), `strategy` (`prime` | `frontier`).

**Dev mode (`VaultVersionContext`, `preference === 'all'`):** Transact **over-balance bypass** only. Explorer filters default to **All** (network, strategy, asset) for everyone — not dev-gated. **No v1/v2 version filter** (v1 removed).

**Dashboard:** Shows all Morpho v1+v2 positions via `/api/user/morpho-positions`; non-curated vaults are read-only on dashboard. Portfolio chart aggregates position-history for **every** deposited Morpho vault (v1 + v2).

---

## V2 transactions (only write path)

All vault writes use **`src/lib/transactionUtilsV2.ts`** (direct ERC-4626 + viem). v1 bundler / `useVaultTransactions` removed.

**Routing:** `TransactionFlow.tsx` → `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` only.

### ERC-4626 reads and UI sources (v2)

| Concern | Source |
|---------|--------|
| **Live Morpho positions** | `/api/user/morpho-positions` → `WalletContext` (not per-vault RPC) |
| **Liquid balances** | Alchemy + wagmi in `WalletContext` |
| **Position history (charts)** | `vaultV2PositionByAddress` → `history` via `/api/vault/v2/.../position-history` |
| **Earned interest** | Morpho `pnl` or activity-based fallback via `/api/vault/v2/.../earned-interest` |
| **Vault TVL / APY** | `vaultV2ByAddress` via `/api/vault/v2/.../complete` and `history` |
| **Headline APY** | `avgNetApyExcludingRewards` (fallback `avgNetApy`) |
| **Liquidity in UI** | GraphQL `liquidity` / `liquidityUsd`, not `totalAssets` |

Share tokens use **18 decimals**; underlying assets use registry decimals (USDC **6**, cbBTC **8**, WETH **18**).

**v1 → v2 migration (portfolio chart only):** `legacy-vaults.ts` + `preparePortfolioVaultHistories()` truncates known Muscadine v1 history at first related **curated** v2 deposit — not symbol-only pairing with external vaults.

---

## On-chain transactions (v2)

### `src/lib/transactionUtilsV2.ts`

Header comment: bundler does not support v2; use direct contract calls.

**Exports:**

| Function | Behavior |
|----------|----------|
| `depositToVaultV2` | ERC-20 `approve` (if needed) → optional WETH `deposit()` wrap → vault `deposit(assets, onBehalf)` |
| `withdrawFromVaultV2` | `previewWithdraw` for shares → vault `withdraw(assets, receiver, owner)` → optional WETH unwrap to ETH |
| `redeemFromVaultV2` | Full share balance → vault `redeem(shares, receiver, owner)` → optional unwrap |
| `approveToken` | Standalone approval helper |

**ABIs (in-file):**

- `ERC20_ABI` — `approve`, `allowance`, `balanceOf`, `decimals`
- `ERC4626_ABI` — `asset`, `deposit`, `withdraw`, `redeem`, `previewWithdraw`, `previewRedeem`, `convertToShares`, `convertToAssets`, …
- `WETH_ABI` — `deposit` (payable wrap), `withdraw` (unwrap)

**WETH Prime vault** (`BASE_WETH_ADDRESS` in `constants.ts`):

- `preferredAsset: 'ETH' | 'WETH' | 'ALL'` on deposit (wrap ETH, use WETH only, or combine with gas reserve `0.0001 ETH`)
- Withdraw: `preferredAsset` `'ETH' | 'WETH'` (not `'ALL'`) — unwrap step when ETH selected

**Approvals:** Spender is the **vault address** (ERC-4626 pulls from user). USDC-style reset-to-zero may run before new approval when needed.

**Progress:** Uses `TransactionProgressCallback` — `approving` for approvals, `confirming` for main tx (same UX rules as v1: do not treat approval hash as final success).

**Routing:** `TransactionFlow.tsx` calls v2 helpers only (`getVaultVersion` always returns `'v2'`).

### Shared transaction utilities — `src/lib/transactionUtils.ts`

- `formatTransactionError`, `isCancellationError`
- Used by `TransactionFlow` error handling

### Transaction orchestration — `TransactionFlow.tsx`

v2-only: `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` (redeem when amount ≈ max via `shouldUseWithdrawAll`).

**Max withdraw detection:** Compares entered amount to `convertToAssets(fullShares)` within 0.1% → uses redeem path.

---

## Morpho GraphQL & API routes

**Endpoint:** `https://api.morpho.org/graphql`  
**Docs:** https://docs.morpho.org/tools/offchain/api/morpho-vaults/

### V2 complete route (`src/app/api/vault/v2/[address]/complete/route.ts`)

Query root: `vaultV2ByAddress(address, chainId)`.

Notable fields: `asset`, `totalAssets`, `totalSupply`, `liquidity`, `liquidityUsd`, `idleAssetsUsd`, `avgNetApy`, `avgNetApyExcludingRewards`, `maxApy`, `adapters`, `rewards`, `warnings`, etc. Response is normalized toward v1-shaped JSON (`vaultByAddress` shape) for shared UI. Headline APY maps from **`avgNetApyExcludingRewards`** (not deprecated `avgApy`).

### V2 history route (`src/app/api/vault/v2/[address]/history/route.ts`)

Query root: `vaultV2ByAddress` → `historicalState`. APY series uses **`avgNetApy` only** (`avgNetApyExcludingRewards` is not on the history type). Maps to `apy` / `netApy` in the JSON response (percent × 100).

### Position history (v1 & v2)

- **V1:** `vaultPosition` + `historicalState.{assets,assetsUsd,shares}`
- **V2:** `vaultV2PositionByAddress` + `history.{assets,assetsUsd,shares}`; raw `assets` / `shares` scaled by asset decimals / 1e18 in the route handler

Both return `currentPosition` + `history[]` with `{ timestamp, assets, assetsUsd, shares }`.

### Incomplete Morpho timeseries buckets

Morpho often returns a **trailing interval** (current hour/day) with **zeros** for TVL and/or position while the in-progress bucket is empty. That makes charts dip to zero on the last point.

**Fix:** `stripIncompleteVaultHistoryBuckets` (vault `history` routes) and `finalizePositionHistory` (`position-history` routes) in `src/lib/api-utils.ts` — applied on **v1 and v2** route responses before JSON is returned.

**`finalizePositionHistory` (position-history only):** uses the live `currentPosition` to disambiguate trailing zeros:

- **Position open** (shares/assets > 0): trailing zero buckets are the in-progress interval → stripped (`stripIncompletePositionHistoryBuckets`).
- **Position closed** (fully withdrawn): trailing zeros are real → kept. If Morpho's stale v1 history still ends at a **pre-withdrawal value**, a **zero point** is appended one bucket after the last point, so the dashboard's forward-fill aggregation drops to zero instead of being stuck at the last held amount (the "portfolio stuck at old v1 balance" bug).

### V1 API (portfolio backfill only)

- **`/api/vault/v1/[address]/position-history`** — kept for Muscadine v1 migration chart backfill (`legacy-vaults.ts`). No v1 complete, activity, history, or `/vault/v1/*` pages.

### Morpho GraphQL schema changes (2025–2026)

If `complete` routes return **HTTP 400**, validate queries against `https://api.morpho.org/graphql` — invalid fields fail the whole request.

| Removed / renamed | Use instead |
|-------------------|-------------|
| `whitelisted` on Vault / VaultV2 | `listed` (map to `whitelisted` in API responses for UI) |
| `state.sharePrice` (v1 VaultState) | Compute from `totalAssets` / `totalSupply` |
| `state.avgApy` (v1) | `avgNetApy` or `apy` |
| `metadata.curators` (v1) | Removed — omit from query |
| `market.uniqueKey` (v1) | `id` (alias as `uniqueKey: id` in query) |
| `historicalState.sharePrice` (v1 VaultHistory) | Removed — derive from `totalAssets` / `totalSupply` in route handler |

**Positions in the UI** use `/api/user/morpho-positions` for Morpho holdings; vault metadata from `/api/vault/v2/.../complete`. Broken GraphQL breaks explorer columns; `WalletContext` falls back to registry metadata when complete fails.

### Caching

`next: { revalidate: 300 }` (~5 minutes) + cache tags like `vault-{address}-{chainId}`.

### Client Apollo

`src/app/Providers.tsx` creates `ApolloClient` with same GraphQL URL for any client-side queries.

---

## Morpho npm packages

**Removed from `package.json`:** `@morpho-org/*` bundler/simulation SDKs (v1 path deleted). Morpho reads use **server `fetch`** to `api.morpho.org` and **Apollo Client** (`graphql@16`) on the client where needed.

**Not a dependency:** `@morpho-org/morpho-sdk` — optional future path for v2 writes via official SDK.

---

## App routes & pages

| Path | Description |
|------|-------------|
| `/` | **Dashboard** — wallet-focused: `WalletOverview`, `PortfolioPositionChart`, `DashboardVaultTable` (deposited vaults only) |
| `/vaults` | **Vault explorer** — filter bar + table of registry vaults |
| `/transact` | Deposit/withdraw flow (`TransactionContext` + `TransactionFlow`) |
| `/vault/v2/[address]` | V2 vault detail |
| `/api/prices` | Price proxy/cache |
| `/api/user/morpho-positions` | User Morpho v1+v2 positions (deduped v2-first) |
| `/api/vault/v1/[address]/position-history` | v1 position history (portfolio backfill only) |
| `/api/vault/v2/...` | V2 Morpho GraphQL proxies |
| `/.well-known/farcaster.json` | Farcaster mini app manifest |

**NavBar:** Dashboard → `/`, Vaults → `/vaults`, Transact → `/transact`. Settings: **Developer mode** toggle (`preference` `v2` ↔ `all`) — transact test bypass only.

**App title:** metadata in `layout.tsx` uses **Muscadine Vaults** (not “Muscadine Earn”).

---

## Dashboard & vault explorer UI

### Dashboard (`/` — `src/app/page.tsx`)

Three-row layout:

| Area | Component | Behavior |
|------|-----------|----------|
| Top | `WalletOverview` | Total / liquid / Morpho USD; dropdown breakdowns |
| Bottom left | `PortfolioPositionChart` | Combined USD portfolio history (Recharts) |
| Bottom right | `DashboardVaultTable` | **v2** vaults where user has non-zero position (registry + external) |

**Important:** Dashboard ignores `VaultVersionContext`. Portfolio chart includes **all** Morpho v1+v2 positions from the API; **Your Vaults** is **v2-only**.

- **Your Vaults** lists v2 deposits only (`position.version === 'v2'`), sorted by USD. External (non-curated) vaults are shown but **not clickable**.
- **Layout:** Chart + Your Vaults use **`min-[1000px]:grid-cols-2`** (side-by-side from ~1000px width; stacked below). `DashboardVaultTable` uses a **compact** `table-fixed` layout at `min-[1000px]+`; card layout below that.
- **Portfolio chart** (`PortfolioPositionChart.tsx`):
  1. Discovers vaults via `/api/user/morpho-positions?includeEmpty=true` (+ legacy v1 backfill for Muscadine migrations).
  2. **`preparePortfolioVaultHistories()`** — curated v1→v2 cutover per `legacy-vaults.ts`.
  3. **`aggregatePortfolioHistory()`** — forward-fill each series and sum USD.
  - **Current holdings** in `WalletOverview` / Your Vaults from **`WalletContext`** (`/api/user/morpho-positions`).
- Preloads vault API data for deposited vaults via `useVaultListPreloader`.
- **Position display:** `formatPositionUsd` / `formatPositionTokenAmount` in `formatter.ts` (full values, no K/M/B; USDC 2 decimals, WETH/cbBTC 4).

### Vault explorer (`/vaults` — `src/app/vaults/page.tsx`)

`VaultExplorer` = `VaultExplorerFilters` + `VaultExplorerTable`.

**Filters** (`VaultExplorerFilters.tsx`) — compact `text-xs` controls:

| Filter | Options | Notes |
|--------|---------|-------|
| Network | All, Base | Default **All**; `base` filters `chainId === 8453` |
| Strategy | All, Prime, Frontier | Default **All** (shows Prime + Frontier) |
| Asset | All, USDC, cbBTC, WETH | Local filter state |
| In Wallet | Toggle | Shows only vaults user is deposited in |

**Table columns** (`VaultExplorerTable.tsx`): Vault, **Your Position**, **Earned Interest**, **APY / TVL** (compact layout). Rows navigate to `/vault/v2/{address}`.

**Vault list sort order** (`sortVaultsForDisplay`): (1) position USD high → low, (2) v2 before v1 (external positions), (3) TVL high → low, (4) name.

**Earned interest:** `useVaultEarnedInterest` for curated vaults; shows **0** when never deposited.

### Vault detail charts (`VaultOverview.tsx`)

Chart tabs (order): **APY** → **Total Deposits** → **Share Price**. **Total Deposits** and **Share Price** support USD / token toggle. Axis labels and tooltips use full values with 2 decimals (`formatCurrency` / `formatAssetAmount`). Stat cards use `formatSmartCurrency`.

---

## State & context

Provider tree (`src/app/Providers.tsx`):

`ErrorBoundary` → `ApolloProvider` → `WagmiProvider` → `QueryClient` → `RainbowKit` → `ThemeProvider` → `AdvisoryAgreementProvider` → `VaultVersionProvider` → `ToastProvider` → `WalletProvider` → `VaultDataProvider` → `TransactionProvider`

| Context | File | Role |
|---------|------|------|
| `WalletContext` | `contexts/WalletContext.tsx` | Alchemy liquid balances; Morpho positions via `/api/user/morpho-positions`; refresh after txs |
| `VaultDataContext` | `contexts/VaultDataContext.tsx` | Cached vault metadata from `/api/vault/.../complete` |
| `TransactionContext` | `contexts/TransactionContext.tsx` | Transact page: from/to accounts, amount, status, `preferredAsset` |
| `VaultVersionContext` | `contexts/VaultVersionContext.tsx` | `preference` (v2 \| Dev/`all`), `isDevMode` — transact bypass only; **not dashboard** |
| `PriceContext` | `contexts/PriceContext.tsx` | Asset USD prices |
| `ToastContext` | `contexts/ToastContext.tsx` | Toasts |
| `ThemeContext` | `contexts/ThemeContext.tsx` | Light/dark |
| `AdvisoryAgreementContext` | `contexts/AdvisoryAgreementContext.tsx` | Legal modal gating |

### Advisory agreement (`AdvisoryAgreementModal.tsx`)

Shown before wallet connect (`ConnectButton` → `AdvisoryAgreementProvider`). Copy is **non-custodial / risk curation only** — not discretionary management or investment advice.

**Legal links (canonical URLs):**

| Label | URL |
|-------|-----|
| Terms of Use | https://muscadine.io/terms |
| Legal Disclaimer | https://muscadine.io/legal |
| Privacy Policy | https://muscadine.io/privacy |
| Risk Framework | https://muscadine.io/risk |
| U.S. economic sanctions (checkbox) | https://ofac.treasury.gov/sanctions-programs-and-country-information |

Same Risk Framework link appears in **NavBar** Muscadine dropdown (Protocol section, with Terms / Legal / Privacy).

**Re-acceptance:** `TERMS_VERSION` in `AdvisoryAgreementContext.tsx` (currently **`2.0.0`**) — bump when legal copy changes; stored in localStorage as `advisory-agreement-version` alongside `advisory-agreement-accepted`.

---

## Key hooks

| Hook | File | Purpose |
|------|------|---------|
| `useVaultEarnedInterest` | `hooks/useVaultEarnedInterest.ts` | Earned interest for curated vaults |
| `useVaultDataFetch` | `hooks/useVaultDataFetch.ts` | Fetch/cache vault API data, list preloader |
| `useClientOnly` | `hooks/useClientOnly.ts` | `useIsClient()`, `useUnixTimestamp()` — SSR-safe patterns |
| `onClickOutside` | `hooks/onClickOutside.ts` | Dropdown dismiss |

---

## Directory map

```text
src/
  app/
    page.tsx              # Dashboard
    vaults/page.tsx       # Vault explorer
  components/
    features/
      vault/              # VaultExplorer*, VaultOverview, VaultPosition, VaultHistory, …
      wallet/             # WalletOverview, PortfolioPositionChart, ConnectButton, …
      transactions/       # TransactionFlow, AccountSelector, confirmation UI
      learn/              # LearnContent
    layout/               # AppLayout, NavBar, RightSidebar
    ui/                   # Button, Modal, Toast, Skeleton, Icon
    common/               # ErrorBoundary, CopiableAddress, MiniAppInit
  config/
    wagmi.ts              # Base + Alchemy + RainbowKit wallets
    navigation.tsx        # Nav links (Vaults → page; transact)
  contexts/               # See table above
  hooks/
  lib/
    portfolio-utils.ts    # ★ preparePortfolioVaultHistories + aggregatePortfolioHistory (dashboard)
    api-utils.ts          # Period/interval helpers; strip incomplete Morpho timeseries tails
    transactionUtilsV2.ts # ★ V2 on-chain (ERC-4626 ABI)
    transactionUtils.ts   # Errors, shared tx helpers
    vaults.ts             # ★ Vault registry (v2 Prime + Frontier)
    vault-utils.ts        # Routes, sortVaultsForDisplay, resolvePositionAssetsUsd, isCuratedVaultAddress
    legacy-vaults.ts      # Muscadine v1 addresses for portfolio chart backfill
    interest-utils.ts     # Earned interest from activity
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

**Progress steps** (`types/transactions.ts`): `signing`, `approving`, `confirming` — shared by v1 and v2.

**Rules:**

- Approval txs use `approving`; only the main vault op should set `confirming` with the hash users care about.
- After success, balances refresh via `refreshBalancesWithPolling` in `TransactionFlow`.

**Transact page** (`app/transact/page.tsx`): Deposit/Withdraw tabs, account pickers, amount, MAX, WETH asset preference, deep links. Registry vaults from `VAULTS` + `sortVaultsForDisplay`. **Dev mode** (`preference === 'all'`): **over-balance bypass** checkbox when amount exceeds wallet balance.

**Transact tabs:** Tab highlight uses `activeTab` (user selection). `effectiveActiveTab` infers deposit vs withdraw from From/To when both accounts are set (WETH prefs, max amount). `handleTabChange` resets accounts per tab; do not no-op on `tab === activeTab` alone — use `accountsMatchTransactionTab()` so mismatched From/To does not block clicks.

**Portfolio position history:** Per-vault API at `/api/vault/{v1|v2}/{address}/position-history` (tails stripped server-side). Dashboard runs **`preparePortfolioVaultHistories` → `aggregatePortfolioHistory`**; single-vault charts use `VaultPosition.tsx`. Do not sum raw v1+v2 history for the same asset without cutover logic.

**Formatting conventions:**

- Table/explorer USD pills: `formatSmartCurrency(..., { alwaysTwoDecimals: true })` for compact TVL/deposits.
- Vault detail **Total Deposits chart** (when toggled): `formatCurrency` / 2-decimal token amounts on axis + tooltip — not abbreviated thousands.

---

## Wallet & balances

`WalletContext`:

- Native ETH + tokens: USDC, cbBTC, WETH, cbETH, wstETH (`TOKEN_ADDRESSES` on Base) via Alchemy
- **Morpho positions:** `/api/user/morpho-positions` (v1+v2 from Morpho GraphQL, deduped v2-first); metadata from `/api/vault/v2/.../complete`
- `refreshBalances`, `refreshBalancesWithPolling` after transactions

---

## Farcaster mini app

- Manifest: `src/app/.well-known/farcaster.json/route.ts`
- Init: `components/common/MiniAppInit.tsx`
- Images: `public/miniapp-image.png`, `miniapp-splash.png`

---

## Configuration & constants

`src/lib/constants.ts`:

- `BASE_CHAIN_ID = 8453`
- `BASE_WETH_ADDRESS` — Base canonical WETH
- `GENERAL_ADAPTER_ADDRESS` — v1 bundler flows
- Cache TTLs: vault data 5m, prices 10m, activity 1m

`next.config.ts`:

- Webpack/Turbopack aliases for `wagmi` and `@tanstack/react-query` (singleton — avoids duplicate React Query context with simulation-sdk-wagmi)
- Externals: `pino-pretty`, `lokijs`, `encoding`

`Providers.tsx` imports `core-js/proposals/iterator-helpers` for `@morpho-org/blue-sdk-wagmi`.

---

## Development

### Commands

```bash
npm run dev      # Turbopack dev server
npm run build
npm run lint
npm start        # Production server
```

### Turbopack chunk error

If you see `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` after mixing `build` and `dev`:

```bash
rm -rf .next .turbo && npm run dev
```

### Adding a vault

1. Add to `src/lib/vaults.ts` with correct `version`.
2. Confirm Morpho GraphQL returns it (`vaultByAddress` or `vaultV2ByAddress`).
3. v2 writes require no change in `transactionUtilsV2` if address is passed dynamically — registry drives UI labels and routing.

### Changing v2 transaction behavior

Edit **`src/lib/transactionUtilsV2.ts` only** (unless changing routing/UX in `TransactionFlow.tsx`). Test approve → deposit and withdraw/redeem on Base with small amounts.

---

## Dependency constraints

Do not bump without checking compatibility:

| Package | Constraint |
|---------|------------|
| `wagmi` | Stay on **2.x** — RainbowKit 2 requirement |
| `eslint` | Stay on **9.x** (`eslint@^9.39`) — `eslint-config-next` breaks on 10 |
| `@morpho-org/*-wagmi` 4.x | Often requires wagmi 3 |

---

## Code conventions

- TypeScript, `@/` → `src/`
- `'use client'` on interactive / wagmi components
- Minimize scope; keep v1 and v2 paths separate
- Use `logger` from `lib/logger.ts` instead of ad-hoc `console.log`
- Resolve vault version from `vaults.ts` / `getVaultVersion`
- **Git commits:** only when the user explicitly asks
- Match existing style in touched files; avoid drive-by refactors

---

## Security

- See `SECURITY.md` — report issues privately to muscadinelabs@gmail.com
- Users sign all transactions in their wallet
- No private keys in the repo; env vars for RPC and WalletConnect only

---

## Future / optional upgrades

### Product / registry (planned)

1. **Multi-chain vaults** — Extend beyond Base to **Ethereum** and **Hyperliquid**: multi-chain `VAULTS` entries, RPC/wagmi chains, Morpho GraphQL `chainId` on API routes, explorer Network filter (today only Base is real; “All” is forward-compatible).
2. **Finish v1 sunset** — v1 UI and most API routes removed; only `position-history` remains for portfolio backfill. Remove cutover logic once no active v1 TVL.

### Technical (optional)

3. **`@morpho-org/morpho-sdk` for v2** — Bundler3 deposits with `maxSharePrice` slippage; `forceWithdraw` / `forceRedeem` when GraphQL `liquidity` is low.
4. **`supportSignature: true`** — Permit/Permit2 to skip extra approval txs.
5. **V2 vault-to-vault transfers** — Not implemented; would need withdraw + deposit coordination.
6. **Enable v2 in bundler** — If Morpho adds v2 to `bundler-sdk-viem`, could unify paths (currently explicitly avoided).

**Morpho doc indexes for LLMs:**

- https://docs.morpho.org/llms.txt  
- https://docs.morpho.org/llms-full.txt  

---

## Quick reference

| Task | Where to look |
|------|----------------|
| Dashboard layout | `src/app/page.tsx` |
| Portfolio history chart | `PortfolioPositionChart.tsx`, `portfolio-utils.ts` (`preparePortfolioVaultHistories`, `aggregatePortfolioHistory`) |
| Morpho timeseries tail fix | `api-utils.ts` (`stripIncomplete*`, `finalizePositionHistory`), used in vault `history` + `position-history` routes |
| Position table formatting | `formatter.ts` (`formatPositionUsd`, `formatPositionTokenAmount`) |
| Vault explorer page | `src/app/vaults/page.tsx`, `VaultExplorer*.tsx` |
| V2 deposit/withdraw/redeem | `src/lib/transactionUtilsV2.ts` |
| Transaction orchestration | `src/components/features/transactions/TransactionFlow.tsx` |
| Vault addresses | `src/lib/vaults.ts` |
| Vault sort / routing | `src/lib/vault-utils.ts` (`sortVaultsForDisplay`, `getVaultRoute`) |
| Earned interest API | `src/app/api/vault/v2/[address]/earned-interest/route.ts` |
| Morpho positions API | `src/app/api/user/morpho-positions/route.ts` |
| Advisory agreement modal | `src/components/features/wallet/AdvisoryAgreementModal.tsx` |
| Dev mode (transact bypass) | `VaultVersionContext.tsx`, `NavBar.tsx` Settings toggle |
| Morpho GraphQL / fetch helper | `src/lib/api-utils.ts` (`fetchMorphoGraphQL`) |
| V2 vault API data | `src/app/api/vault/v2/[address]/complete/route.ts` |
| Transact state | `src/contexts/TransactionContext.tsx` |
| Total Deposits chart formatting | `src/components/features/vault/VaultOverview.tsx` |
| User-facing README | `README.md` |
