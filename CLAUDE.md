# CLAUDE.md — Muscadine App

Comprehensive context for AI assistants and developers. This is the canonical “extra README” for the repo: architecture, Morpho integration, file map, conventions, and operational notes.

**Product:** Web app for Muscadine vaults on **Base (chain id 8453)** — deposit, withdraw, portfolio view, vault analytics. Supports **v1 MetaMorpho** vaults and **v2 Prime (VaultV2)** vaults for USDC, cbBTC, and WETH.

**Version:** `package.json` → `1.0.4`

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
│  TransactionFlow ──┬── v1 ──► useVaultTransactions (bundler)   │
│                    └── v2 ──► transactionUtilsV2 (ERC-4626 ABI)  │
│                                                                  │
│  WalletContext, VaultDataContext, TransactionContext, …          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              Next.js Route Handlers (/api/...)                   │
│  POST https://api.morpho.org/graphql  (revalidate ~5 min)         │
│  vaultByAddress (v1)  |  vaultV2ByAddress (v2)                   │
└─────────────────────────────────────────────────────────────────┘
```

**Reads:** Morpho GraphQL (server routes + some client Apollo usage).

**Writes:** User wallet signs transactions built in-app — **not** via GraphQL.

---

## Vault registry

Single source of truth: `src/lib/vaults.ts` → `VAULTS` record.

Always resolve version with `getVaultVersion(address)` / `findVaultByAddress()` from `src/lib/vault-utils.ts`. Do not infer v1/v2 from asset symbol alone.

| Asset | V1 MetaMorpho | V2 Prime |
|-------|---------------|----------|
| USDC | `0xf7e26Fa48A568b8b0038e104DfD8ABdf0f99074F` | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` |
| cbBTC | `0xAeCc8113a7bD0CFAF7000EA7A31afFD4691ff3E9` | `0x99dcd0D75822BA398F13B2A8852B07c7e137EC70` |
| WETH | `0x21e0d366272798da3A977FEBA699FCB91959d120` | `0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43` |

**Routes:** `/vault/v1/{address}`, `/vault/v2/{address}`  
**API:** `/api/vault/{v1|v2}/{address}/{complete|history|activity|position-history}`

**UI default (v1/v2 filter):** Defaults to **v2** via `VaultVersionContext` (localStorage key `muscadine-vault-version-default-v2`). Applies to **`/vaults` explorer**, **NavBar Settings**, **VaultsDropdown**, and **transact** vault pickers — **not** the dashboard (see below).

---

## V1 vs V2 — the most important split

| | **V1 (MetaMorpho)** | **V2 (Prime / VaultV2)** |
|--|----------------------|---------------------------|
| On-chain type | ERC-4626 MetaMorpho | Morpho VaultV2 (ERC-4626-like interface) |
| **Write path** | `useVaultTransactions.ts` + `setupBundle` | `transactionUtilsV2.ts` + viem `writeContract` |
| Bundler | Yes (`@morpho-org/bundler-sdk-viem`) | **No** — bundler does not expose v2 MetaMorpho ops |
| Simulation | `useVaultSimulationState` + simulation-sdk-wagmi | Same hook can load v2 vaults in simulation state; **tx execution does not use bundler** |
| Deposit slippage | Bundler / blue-sdk defaults | Direct `deposit` on vault (no Bundler3 path in app) |
| Vault-to-vault transfer | Supported (single bundle) | **Not supported** — explicit error in `TransactionFlow` |
| GraphQL entity | `vaultByAddress` | `vaultV2ByAddress` |

**Do not** call v1 `MetaMorpho_Deposit` / bundler operations against v2 addresses.

**Optional future path:** Morpho’s `@morpho-org/morpho-sdk` v2 supports VaultV2 deposits via Bundler3 with slippage guards and `forceWithdraw`/`forceRedeem` for low idle liquidity. This app **intentionally** uses direct ABIs for v2 unless that decision is reversed.

### ERC-4626 vaults — reads, shares, and UI sources

Both v1 MetaMorpho and v2 Prime expose an **ERC-4626-style** interface for deposits/withdrawals (`asset`, `deposit`, `withdraw`, `redeem`, `convertToAssets`, `previewWithdraw`, etc.). Share tokens use **18 decimals**; underlying assets use registry decimals (USDC **6**, cbBTC/WETH **18**).

| Concern | V1 (MetaMorpho) | V2 (Prime / VaultV2) |
|---------|-----------------|----------------------|
| **Live position (dashboard, tables)** | `WalletContext` — on-chain `balanceOf` + `convertToAssets` per vault | Same RPC path |
| **Position history (charts)** | GraphQL `vaultPosition` → `historicalState` | GraphQL `vaultV2PositionByAddress` → `history` |
| **Vault TVL / APY history** | `vaultByAddress` → `historicalState` | `vaultV2ByAddress` → `historicalState` |
| **Headline APY (complete API)** | `state.apy` / `avgApy` | `avgNetApyExcludingRewards` (fallback `avgNetApy`) — **`avgApy` deprecated** on v2 |
| **Liquidity in UI** | MetaMorpho idle/liquidity fields | Use GraphQL **`liquidity`** / `liquidityUsd`, **not** `totalAssets` (deposits) |

**v1 → v2 migration:** Users may hold the same asset in both vault versions over time. Morpho **v1 position history often remains non-zero after withdrawal** while `currentPosition` is already 0. Naïvely summing all six registry vaults with forward-fill **double-counts** (~2× portfolio USD from the migration date onward). The dashboard fixes this in `preparePortfolioVaultHistories()` (see [Dashboard](#dashboard--vault-explorer-ui)).

---

## On-chain transactions

### V2 — `src/lib/transactionUtilsV2.ts`

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

**Routing:** `TransactionFlow.tsx` calls these when `getVaultVersion(...) === 'v2'`.

### V1 — `src/hooks/useVaultTransactions.ts`

- `setupBundle` from `@morpho-org/bundler-sdk-viem`
- Actions: `deposit`, `withdraw`, `withdrawAll`, `transfer`
- Uses `useVaultSimulationState` for bundler + simulation
- WETH: can include unwrap in bundle via bundler operations
- `DEFAULT_SLIPPAGE_TOLERANCE` from `@morpho-org/blue-sdk`
- `GENERAL_ADAPTER_ADDRESS` in `constants.ts` for adapter flows

### Shared transaction utilities — `src/lib/transactionUtils.ts`

- `formatTransactionError`, `isCancellationError`
- Used by `TransactionFlow` error handling

### Transaction orchestration — `TransactionFlow.tsx`

1. Detect v1/v2 from vault addresses involved.
2. v2 → `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` (redeem when amount ≈ max via `shouldUseWithdrawAll`).
3. v1 → `executeVaultAction` from `useVaultTransactions`.
4. Simulation hook enabled for preview/execute when `vaultAddress` set (**includes v2 address** for holdings/sim state, but v2 execution bypasses bundler).

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

**Fix:** `stripIncompleteVaultHistoryBuckets` / `stripIncompletePositionHistoryBuckets` in `src/lib/api-utils.ts` — applied on **v1 and v2** `history` and `position-history` route responses before JSON is returned.

### V1 complete route

Query root: `vaultByAddress` (v1 schema).

### Caching

`next: { revalidate: 300 }` (~5 minutes) + cache tags like `vault-{address}-{chainId}`.

### Client Apollo

`src/app/Providers.tsx` creates `ApolloClient` with same GraphQL URL for any client-side queries.

---

## Morpho npm packages

| Package | Used for |
|---------|----------|
| `@morpho-org/bundler-sdk-viem` | **V1 only** — bundle construction |
| `@morpho-org/blue-sdk` | Entities, slippage constants, types |
| `@morpho-org/blue-sdk-viem` | Low-level reads / ABIs in Morpho ecosystem |
| `@morpho-org/blue-sdk-wagmi` | Wagmi hooks for simulation / holdings |
| `@morpho-org/simulation-sdk` | Transaction simulation |
| `@morpho-org/simulation-sdk-wagmi` | React integration for simulation |
| `@morpho-org/morpho-ts` | Shared utilities |

**Not a dependency (by design):** `@morpho-org/morpho-sdk` — optional if migrating v2 writes to official SDK later.

---

## App routes & pages

| Path | Description |
|------|-------------|
| `/` | **Dashboard** — wallet-focused: `WalletOverview`, `PortfolioPositionChart`, `DashboardVaultTable` (deposited vaults only) |
| `/vaults` | **Vault explorer** — filter bar + Morpho-style table of all registry vaults |
| `/transact` | Deposit/withdraw flow (`TransactionContext` + `TransactionFlow`) |
| `/vault/v1/[address]` | V1 vault detail (tabs: overview, position, history) |
| `/vault/v2/[address]` | V2 vault detail |
| `/api/prices` | Price proxy/cache |
| `/api/vault/v1/...` | V1 Morpho GraphQL proxies |
| `/api/vault/v2/...` | V2 Morpho GraphQL proxies |
| `/.well-known/farcaster.json` | Farcaster mini app manifest |

**NavBar:** Dashboard → `/`, Vaults → `/vaults`, Transact → `/transact`. Settings dropdown toggles v1 / v2 / all (same state as `/vaults` Version filter).

**App title:** metadata in `layout.tsx` uses **Muscadine Vaults** (not “Muscadine Earn”).

---

## Dashboard & vault explorer UI

### Dashboard (`/` — `src/app/page.tsx`)

Three-row layout:

| Area | Component | Behavior |
|------|-----------|----------|
| Top | `WalletOverview` | Total / liquid / Morpho USD; dropdown breakdowns |
| Bottom left | `PortfolioPositionChart` | Combined USD portfolio history (Recharts) |
| Bottom right | `DashboardVaultTable` | Vaults where user has **non-zero** position |

**Important:** Dashboard **ignores** `VaultVersionContext`. Positions and charts include **both v1 and v2** vaults from the registry.

- **Your Vaults** lists only vaults with a current deposit (`morphoHoldings.positions`), sorted by USD value. Empty state links to `/vaults`.
- **Layout:** Chart + Your Vaults use **`min-[1000px]:grid-cols-2`** (side-by-side from ~1000px width; stacked below). `DashboardVaultTable` uses a **compact** `table-fixed` layout at `min-[1000px]+`; card layout below that.
- **Portfolio chart** (`PortfolioPositionChart.tsx`):
  1. Fetches position history for **all 6 registry vaults** (`period=all` / `7d` / `30d`).
  2. **`preparePortfolioVaultHistories()`** — per asset (USDC, cbBTC, WETH), if v2 has deposits: truncate v1 history before first v2 deposit and append a **$0 point at cutover** so forward-fill does not stack v1 + v2 balances after migration.
  3. **`aggregatePortfolioHistory()`** — forward-fill each prepared series and sum USD.
  - **Current holdings** in `WalletOverview` / Your Vaults come from **RPC** (`WalletContext`), not the chart aggregate — they should match when dedupe is correct.
- Preloads vault API data for deposited vaults via `useVaultListPreloader`.
- **Position display:** `formatPositionUsd` / `formatPositionTokenAmount` in `formatter.ts` (full values, no K/M/B; USDC 2 decimals, WETH/cbBTC 4).

### Vault explorer (`/vaults` — `src/app/vaults/page.tsx`)

`VaultExplorer` = `VaultExplorerFilters` + `VaultExplorerTable`.

**Filters** (`VaultExplorerFilters.tsx`) — compact `text-xs` controls:

| Filter | Options | Notes |
|--------|---------|-------|
| Network | All, Base | Default **All**; `base` filters `chainId === 8453` (ready for more chains) |
| Version | V2, V1, All | Wired to **`VaultVersionContext`** — synced with NavBar Settings |
| Asset | All, USDC, cbBTC, WETH | Local filter state |
| In Wallet | Toggle | Shows only vaults user is deposited in |

**Table columns** (`VaultExplorerTable.tsx`): Network, Vault (logo + name + v1/v2 badge), **Your Position** (when wallet connected), Deposits, Liquidity, APY. No Exposure/Curator columns. Rows navigate to vault detail. Sorted by TVL descending.

**Liquidity data:** `VaultDataContext` maps v2 `liquidityUsd` / `liquidity` from GraphQL when available (`liquidityAssets` on `Vault` type).

### Vault detail charts (`VaultOverview.tsx`)

**Total Deposits** chart (TVL tab) has USD / token toggle. Axis labels and tooltips use **full values with 2 decimals** (`formatCurrency` / `formatAssetAmount`) — not `k`/`M` abbreviations on the chart itself. Stat cards above still use `formatSmartCurrency` for compact display.

### Legacy list components

- `VaultList` / `VaultListCard` — still exported; used for selection flows (e.g. transact). Dashboard no longer uses full `VaultList`.
- `VaultsDropdown` — still in `layout/` exports; primary nav uses `/vaults` link instead.

---

## State & context

Provider tree (`src/app/Providers.tsx`):

`ErrorBoundary` → `ApolloProvider` → `WagmiProvider` → `QueryClient` → `RainbowKit` → `ThemeProvider` → `AdvisoryAgreementProvider` → `VaultVersionProvider` → `ToastProvider` → `WalletProvider` → `VaultDataProvider` → `TransactionProvider`

| Context | File | Role |
|---------|------|------|
| `WalletContext` | `contexts/WalletContext.tsx` | ETH + ERC-20 balances (Alchemy), Morpho positions, USD totals, refresh/polling after txs |
| `VaultDataContext` | `contexts/VaultDataContext.tsx` | Cached vault metadata from `/api/vault/.../complete` |
| `TransactionContext` | `contexts/TransactionContext.tsx` | Transact page: from/to accounts, amount, status, `preferredAsset` |
| `VaultVersionContext` | `contexts/VaultVersionContext.tsx` | v1 / v2 / all filter for **`/vaults`**, transact, VaultsDropdown — **not dashboard** |
| `PriceContext` | `contexts/PriceContext.tsx` | Asset USD prices |
| `ToastContext` | `contexts/ToastContext.tsx` | Toasts |
| `ThemeContext` | `contexts/ThemeContext.tsx` | Light/dark |
| `AdvisoryAgreementContext` | `contexts/AdvisoryAgreementContext.tsx` | Legal modal gating |

---

## Key hooks

| Hook | File | Purpose |
|------|------|---------|
| `useVaultTransactions` | `hooks/useVaultTransactions.ts` | V1 execute + simulation gate |
| `useVaultSimulationState` | `hooks/useVaultSimulationState.ts` | Bundler/simulation state (v1 + v2 vault entities) |
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
      vault/              # VaultExplorer*, VaultOverview, VaultPosition, VaultHistory, VaultList, …
      wallet/             # WalletOverview, PortfolioPositionChart, ConnectButton, …
      transactions/       # TransactionFlow, AccountSelector, confirmation UI
      learn/              # LearnContent
    layout/               # AppLayout, NavBar, RightSidebar, VaultsDropdown
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
    vaults.ts             # ★ Vault registry (6 vaults)
    vault-utils.ts        # Version, routes, chart Y-axis helpers
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

**Transact page** (`app/transact/page.tsx`): Large form — account pickers, amount, MAX, WETH asset preference, deep links via query params.

**Portfolio position history:** Per-vault API at `/api/vault/{v1|v2}/{address}/position-history` (tails stripped server-side). Dashboard runs **`preparePortfolioVaultHistories` → `aggregatePortfolioHistory`**; single-vault charts use `VaultPosition.tsx`. Do not sum raw v1+v2 history for the same asset without cutover logic.

**Formatting conventions:**

- Table/explorer USD pills: `formatSmartCurrency(..., { alwaysTwoDecimals: true })` for compact TVL/deposits.
- Vault detail **Total Deposits chart** (when toggled): `formatCurrency` / 2-decimal token amounts on axis + tooltip — not abbreviated thousands.

---

## Wallet & balances

`WalletContext`:

- Native ETH + tokens: USDC, cbBTC, WETH, cbETH, wstETH (`TOKEN_ADDRESSES` on Base)
- Morpho positions per vault in `VAULTS`
- Alchemy token balance API (see `types/api.ts`)
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
| `eslint` | Stay on **9.x** — `eslint-config-next` breaks on 10 |
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

1. **`@morpho-org/morpho-sdk` for v2** — Bundler3 deposits with `maxSharePrice` slippage; `forceWithdraw` / `forceRedeem` when GraphQL `liquidity` is low.
2. **`supportSignature: true`** — Permit/Permit2 to skip extra approval txs.
3. **V2 vault-to-vault transfers** — Not implemented; would need withdraw + deposit coordination.
4. **Enable v2 in bundler** — If Morpho adds v2 to `bundler-sdk-viem`, could unify paths (currently explicitly avoided).

**Morpho doc indexes for LLMs:**

- https://docs.morpho.org/llms.txt  
- https://docs.morpho.org/llms-full.txt  

---

## Quick reference

| Task | Where to look |
|------|----------------|
| Dashboard layout | `src/app/page.tsx` |
| Portfolio history chart | `PortfolioPositionChart.tsx`, `portfolio-utils.ts` (`preparePortfolioVaultHistories`, `aggregatePortfolioHistory`) |
| Morpho timeseries tail fix | `api-utils.ts` (`stripIncomplete*`), used in vault `history` + `position-history` routes |
| Position table formatting | `formatter.ts` (`formatPositionUsd`, `formatPositionTokenAmount`) |
| Vault explorer page | `src/app/vaults/page.tsx`, `VaultExplorer*.tsx` |
| V2 deposit/withdraw/redeem | `src/lib/transactionUtilsV2.ts` |
| V1 deposit/withdraw/transfer | `src/hooks/useVaultTransactions.ts` |
| Route v1 vs v2 txs | `src/components/features/transactions/TransactionFlow.tsx` |
| Vault addresses | `src/lib/vaults.ts` |
| Version / API paths | `src/lib/vault-utils.ts` |
| V2 vault API data | `src/app/api/vault/v2/[address]/complete/route.ts` |
| Wagmi config | `src/config/wagmi.ts` |
| v1/v2 filter (not dashboard) | `src/contexts/VaultVersionContext.tsx` |
| Transact state | `src/contexts/TransactionContext.tsx` |
| Total Deposits chart formatting | `src/components/features/vault/VaultOverview.tsx` |
| User-facing README | `README.md` |
