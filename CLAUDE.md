# CLAUDE.md — Muscadine Vaults

Comprehensive context for AI assistants and developers. This is the canonical “extra README” for the repo: architecture, Morpho integration, file map, conventions, and operational notes.

**Product:** **Muscadine Vaults** — web app for curated Morpho vaults on **Base (chain id 8453)** — deposit, withdraw, portfolio view, vault analytics. **v2 Prime and Frontier** vaults for USDC, cbBTC, and WETH. **v1 MetaMorpho removed** from registry and codebase (v2-only writes).

**Version:** `package.json` → `1.5.1`

---

## Working agreement (read first)

- **Review `TODO.md` at the start of every session.** It is the canonical task list: items under “TO work on today” are actionable now; “To work on another day” is backlog. Remove or update entries as work completes.
- **Before every push to GitHub:** run `npm run lint` and `npm run build` locally and make sure both pass. GitHub Actions only lints — never put API keys or a dummy-key build in the workflow.
- **Git, branches and PRs:** AI assistants may commit, create branches, push those branches, and open pull requests without asking first. **Never push to, commit directly on, force-push, or merge into `main`** — every change reaches `main` only through a PR that the user merges. Work on a feature branch (create one if you are on `main`).
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
16. [Wallet UIs and app identity](#wallet-uis-and-app-identity)
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
| `NEXT_PUBLIC_URL` or `NEXT_PUBLIC_APP_URL` | No (if unset: the Vercel production domain, `VERCEL_PROJECT_PRODUCTION_URL`, on Vercel; `http://localhost:3000` elsewhere) | Canonical URL + Base Account `appUrl` |

Never commit real keys. `.env.example` documents placeholders.

`package.json` **`allowScripts`** allowlists the install scripts of `@reown/appkit` (AppKit version check) and `fsevents` (Vite file watching on macOS, dev only). `bufferutil`, `keccak` and `utf-8-validate` left with the WalletConnect ethereum-provider in the wagmi 3 / AppKit 2 upgrade. Keep versions pinned to `package-lock.json`. Local npm 11.4 does not have `npm approve-scripts`; Vercel’s newer npm emits the pending-scripts warning without this field.

`package.json` **`overrides`** also pins patched transitive packages GitHub Dependabot flags (`axios`, `js-yaml` 4.x, `brace-expansion` 1.x/5.x, `browserslist` 4.29.6, `follow-redirects`, `ws`). Do not drop those pins without checking [Dependabot alerts](https://github.com/Muscadine-Labs/app/security). Pins for packages that left the tree with the wagmi 3 / AppKit 2 upgrade (`uuid`, `hono`, `socket.io-parser`, `decode-uri-component`) were removed; the `qr` pin was removed too (nothing installs `qr`; AppKit 2 uses `qrcode`). `npm ls` reports `@x402/*` 2.27.0 (pinned by `@reown/appkit-utils`) as invalid for `@coinbase/cdp-sdk`'s optional `^2.29.0` peer, and `@solana/kit` 8.6.0 as invalid for `@solana-program/*`'s `^5.0` (both under `@base-org/account` → `@coinbase/cdp-sdk`); it is never bundled (`next.config.ts` aliases it to `src/lib/x402-stub.js`) and `.npmrc` `legacy-peer-deps=true` keeps `npm ci` passing — keep that file.

---

## Tech stack

| Layer | Technology |
|--------|------------|
| Framework | Next.js 16 (App Router) |
| Bundler (dev/build) | Turbopack (`next dev --turbopack`, `next build --turbopack`) |
| UI | React 19, Tailwind CSS 4 |
| Wallet | wagmi **3.x**, Reown AppKit **2.x**, viem 2 |
| Chain | Base only (`8453`) |
| Server data | Next.js Route Handlers → Morpho GraphQL |
| Client GraphQL | None — Morpho GraphQL is server-only via `fetchMorphoGraphQL()` |
| V2 txs | Direct ERC-4626 via viem (`transactionUtilsV2.ts`); force exits via vault `multicall` (`force-withdraw-v2.ts`) |
| Charts | Recharts |
| Base Account SDK | `@base-org/account` |

---

## Architecture overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (client)                         │
│  Reown AppKit / wagmi ──► viem PublicClient + WalletClient       │
│                                                                  │
│  TransactionFlow ──► transactionUtilsV2 (ERC-4626; force exit is vault multicall) │
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

**Writes:** User wallet signs transactions built in-app — **not** via GraphQL. Deposits, plain withdraws, and force exits are direct vault calls and pay the vault asset (WETH vaults take and pay WETH).

---

## Vault registry

Single source of truth: `src/lib/vaults.ts` → `VAULTS` record.

Always resolve a vault with `findVaultByAddress()` from `src/lib/vault-utils.ts`. Every registry vault is v2. Do not infer v1/v2 from asset symbol alone.

The product surface is four curated Morpho Vault V2 contracts in `src/lib/vaults.ts` that allocate to Blue markets. Query them with `vaultV2ByAddress`. Deposits and plain withdraws are ERC-4626. A withdraw larger than instant liquidity force-deallocates the vault's markets, then withdraws, in one vault `multicall`.

| Asset | Prime | Frontier |
|-------|-------|----------|
| USDC | `0x89712980Cb434eF5aE4AB29349419eb976B0b496` (mpUSDC) | `0x314fD07319ef645bA7D548915CCd91F4788A1839` (mfUSDC) |
| WETH | `0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43` (mpWETH) | — |
| cbBTC | `0x99dcd0D75822BA398F13B2A8852B07c7e137EC70` (mpcbBTC) | — |

**Routes:** `/vault/v2/{address}` only (curated registry addresses).  
**API:** `/api/vault/v2/{address}/{complete|history|activity|position-history|earned-interest|allocations|caps|pending}`

**Vault names in lists:** `preferredVaultName` (`vault-utils.ts`): Morpho `/complete` name, then the positions / registry name, and the `Vault 0x…` placeholder (`vaultAddressPlaceholderName`) only when nothing else has one.

**Vault registry fields:** `name` (fallback label), `symbol` (underlying asset), `vaultSymbol` (share token label), `strategy` (`prime` | `frontier`). Once Morpho returns a vault, the UI shows Morpho's on-chain `name` (explorer, dashboard, vault page, positions route, review modal); the registry `name` shows only until then or when Morpho has none.

**Vault page My Position** (`VaultPosition.tsx`): the chart is this vault's position history. Earned interest, the live balance, withdraw max, and future rewards are this vault's own on-chain position. There is no Settings switch for vault views (the old Vault View / Shared vault data prefs and their cookie are gone).

**Vault page access** (`resolveVaultPageAccess` in `vault-access.ts`) allows a vault the wallet can deposit into, holds, or that the explorer lists (`listedVaultAddresses`: every registry vault, so a vault the wallet cannot deposit into opens with deposit disabled). It also reads the wallet's share balance on chain, so a holder reaches the page even when the Morpho positions API fails or lags. Once allowed, the page stays open for that wallet so a full withdraw does not redirect away mid-success.

**Explorer visibility** (`ExplorerVaultsContext`): every registry vault is listed. Registry balances come from the chain (`WalletContext`), so a holder still sees the position when the positions API fails. A listed vault the wallet cannot deposit into gets an **Approved wallets only** pill; that needs a successful read saying no (`blockedVaultAddresses` from `useVaultDepositGates`, `resolveDepositBlocked`), so a failed gate read never shows it.

Explorer filters default to **All** (network, strategy, asset). Strategy and Asset options come from the registry (`getRegistryVaultList`), and a filter with a single option is hidden. **No v1/v2 version filter** (v1 removed). There is no developer/over-balance bypass mode.

**Dashboard:** Shows Morpho **v2** positions via `/api/user/morpho-positions`; non-curated vaults are read-only on dashboard. Portfolio chart aggregates v2 position-history only.

---

## V2 transactions (only write path)

All vault writes go through **`src/lib/transactionUtilsV2.ts`**. ERC-4626 ops and force exits are direct viem calls.

**Routing:** `TransactionFlow.tsx` → `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` / `forceWithdrawFromVaultV2` (when amount > instant liquidity).

### ERC-4626 reads and UI sources (v2)

| Concern | Source |
|---------|--------|
| **Your balances (registry vaults)** | On chain: `readRegistryVaultBalances` (`lib/onchain-positions.ts`, `balanceOf` + `convertToAssets` multicalls) merged into `WalletContext.morphoHoldings`, priced with live token prices. Vault page position and the withdraw max also read on chain. |
| **Deposit / withdraw amounts** | RPC only: deposit MAX is the wallet's on-chain `balanceOf` (the wallet token list only while it loads); withdraw uses on-chain shares + `convertToAssets`, a simulate, the force planner, and `readInstantLiquidityAssets` (`force-withdraw-v2.ts`) for the warning's instant-liquidity figure. No API data feeds a transaction amount. |
| **Live Morpho positions** | `/api/user/morpho-positions` → `WalletContext`: profit (`pnl`) and non-registry vaults; registry balances are replaced by the on-chain read |
| **Liquid balances** | One `balanceOf` multicall over every registry vault asset (`fetchAllTokenBalances` in `WalletContext`), priced by address from Morpho, plus wagmi ETH (priced as WETH) |
| **Position history (charts)** | `vaultV2PositionByAddress` → `history` via `/api/vault/v2/.../position-history`. Client reads go through `fetchPositionHistoryJson` (`lib/position-history-cache.ts`): 60s cache shared by the dashboard and vault page, in-flight dedupe, failures not kept, cleared by `refreshBalances`; after a transaction `markPositionHistoryTransaction()` (in `refreshBalancesWithPolling`) clears it and stores nothing for 2 minutes while Morpho indexes the transaction. HTTP-200 `{ error }` bodies are failures and are not kept. |
| **Earned interest** | Morpho `pnl` or activity-based fallback via `/api/vault/v2/.../earned-interest` |
| **Vault TVL / APY** | `vaultV2ByAddress` via `/api/vault/v2/.../complete` and `history` |
| **Headline APY** | Morpho `netApy` (current allocation-weighted; fallbacks `apy` / `avgNetApy` / `avgNetApyExcludingRewards`) |
| **Liquidity in UI** | GraphQL `liquidity` / `liquidityUsd`, not `totalAssets` (the withdraw cap is read on chain at send time) |

**Rule:** anything about the user's own money (position, deposit / withdraw amounts, share balance) comes from on-chain RPC. Vault-level data (deposits, TVL, APY, liquidity, token prices) and every chart come from APIs. Earned interest is Morpho `pnl`, with an activity-based fallback against the on-chain balance.

**Token list and prices (any token):** the token list is each registry vault's own `asset()`, read on chain once per page load with its `decimals()` and `symbol()` (`readRegistryAssets` in `lib/registry-assets.ts`). `PriceContext` loads that list and prices it from `/api/prices?addresses=…`, which reads Morpho `assets(where: { address_in })` → `price { usd }` and `logoURI` (`lib/token-prices.ts`, cached 60s). Native ETH uses the WETH price. Learned tokens are registered in `lib/token-metadata.ts`, so `getAssetDecimalsForSymbol`, `findTokenBySymbol` and `getVaultLogo` (bundled logo, then Morpho logo from `cdn.morpho.org`, then the app icon) work for a token with no hardcoded entry. Adding a vault in a new token needs only the registry row. CoinGecko and the hardcoded USDC / cbBTC / WETH token list are gone. Resilience: each vault is read with `allowFailure`, a `bytes32` `symbol()` is decoded, and a failed or partial read is retried every 30s while `fallbackRegistryAssets` (merged into a partial read by `withFallbackAssets`, in prices and wallet balances; the wallet re-reads token balances when the asset list changes) (USDC / cbBTC / WETH matched by the registry label, plus WETH for ETH) stands in. With no Morpho price, a stablecoin is $1 and anything else is 0 (activity too). The wallet token list is tagged with its wallet, so a failed read after a switch never shows another wallet's tokens. The transact panel takes decimals from the vault's on-chain asset and re-applies its accounts when that read lands. Logos use `useTokenLogo` so a Morpho logo shows once it loads; only `https://cdn.morpho.org/` logos are kept. A registry label is an extra symbol only when no other token holds it. Privacy settings are listed under **Wallet & balances → Privacy**; the privacy page covers Reown's mandatory connection events under Reown / WalletConnect.

Share tokens use **18 decimals**; underlying assets use the decimals read from each vault asset on chain (USDC **6**, cbBTC **8**, WETH **18**).

---

## On-chain transactions (v2)

### `src/lib/transactionUtilsV2.ts`

Direct ERC-4626 for deposit, plain withdraw, and redeem. Force exits use vault `multicall`. Exits pay the vault asset. There is no native ETH wrap or unwrap.

**Exports:**

| Function | Behavior |
|----------|----------|
| `depositToVaultV2` | Direct ERC-4626 deposit. WETH vaults take WETH only. |
| `withdrawFromVaultV2` | Direct `withdraw`. Pays the vault asset. |
| `redeemFromVaultV2` | Direct `redeem`. Pays the vault asset. |
| `forceWithdrawFromVaultV2` | Vault `multicall` force-deallocate + withdraw/redeem. Replanned from on-chain reads immediately before send; falls back to plain withdraw/redeem when instant liquidity now covers the amount. |

**ABIs (in-file):**

- `ERC20_ABI` — `approve`, `allowance`, `balanceOf`, `decimals`
- `ERC4626_ABI` — `asset`, `deposit`, `withdraw`, `redeem`, `previewWithdraw`, `convertToAssets`

**WETH vaults** (vault `asset()` is `BASE_WETH_ADDRESS`):

- Deposit and withdraw are WETH only. There is no ETH, ETH+WETH, or unwrap option.
- **Native ETH was rebuilt and tested, then dropped for complexity** (PR #120, tested on a Base mainnet fork). If it is ever revisited:
  - Base WETH (WETH9) pays out with Solidity `transfer` (2300 gas). A plain EOA receives it; a Coinbase Smart Wallet / Base Account proxy reverts, and so do EIP-7702 accounts whose delegate does work on receive. An `eth_call` of `WETH.withdraw(0)` from the wallet detects this. Wrapping (`WETH.deposit`) works for every wallet. Bundler3's GeneralAdapter1 `unwrapNative` sends ETH with full gas, which is why the old path used it.
  - Never unwrap the wallet's WETH balance (it can hold WETH from before, plus interest dust). `withdraw(assets)` pays exactly `assets`; `redeem` pays an amount fixed only when mined, so unwrap the WETH `Transfer` from the vault to the user in the exit receipt.
  - A retry after a lost unwrap confirmation must check the sent unwrap on chain first, or it unwraps a second time out of WETH the wallet held before.
  - EIP-5792 `atomic.status: 'ready'` means the wallet would first upgrade the EOA to a 7702 smart account; treat it as not batchable so users are never prompted to upgrade mid-deposit.
- USDC / cbBTC deposits and plain withdraws stay direct ERC-4626.

**Force withdraw** (`src/lib/force-withdraw-v2.ts`): when requested assets exceed instant liquidity, plan a cash exit. Warning modal shows estimated penalty, risks, and **Force withdraw**, plus **Open vault on Morpho**. If markets cannot cover the shortfall, the input is capped at the reachable amount. The plan is rebuilt from fresh on-chain reads immediately before it is sent. Instant liquidity for planning is always read on-chain (idle + what the liquidity adapter's route market can pay), never taken from the API.

**Force-redeem dust:** the redeem share count is fixed when the tx is built (`balance − estimated penalty shares`), and interest accrued before it is mined makes the penalty burn slightly fewer shares, so a few shares stay behind (~1e-14 WETH). A vault-only `multicall` cannot redeem "whatever is left". `readRegistryVaultBalances` therefore treats a position below `vaultDustThreshold` (1e-9 token for 18 decimals, otherwise under one base unit) as empty. A near-max amount whose shares plus penalty shares exceed the balance is planned as a redeem of the rest (`expectedAssetsOut` = its value). The plan keeps the user's MAX intent in `maxExit`, separate from `exitMode`: when the send-time replan finds enough instant liquidity, a near-max plan falls back to `withdraw(requestedAssets)`, and only a MAX plan to `redeem` of every share. When a planned redeem fails its simulation, the fallback withdraws what the shares left after the penalty are worth (not the full requested amount, which would revert). The send-time replan is compared with the plan the user accepted (`isForcePlanWorse`): if it pays more than 0.1% less or burns more than 0.1% more penalty, nothing is sent and `ForceWithdrawPlanChangedError` reopens the warning with the new figures and a "liquidity changed" note.

Vault `multicall` of `forceDeallocate` × N + `withdraw` or **`redeem` (MAX)** from Morpho Blue market adapters (`abi.encode(marketParams)`). Planner reads on-chain market cash. The liquidity route market (`liquidityAdapter` + `liquidityData`) is never force-deallocated: it is already counted as instant liquidity, and draining it first makes the final withdraw revert. Vault V2 `maxWithdraw` is never used.

This is **not** in-kind redemption. In-kind (`vault.inKindRedeem` → VaultExitBundlesV1 `vaultExitBundlesV1InKindRedemptionVaultV2`) burns shares and transfers Morpho Blue supply positions to the user. Not implemented. Do not swap force withdraw for `vaultExitBundlesV1ForceWithdrawVaultV2` (bundle helper with referral fee / minSharePrice). Cash exits stay vault `multicall`. Do not add Bundler3 or a native-ETH path.

**Approvals:**

- Direct deposit: spender is the **vault**.
- USDC-style reset-to-zero runs before a new ERC-20 asset approval when a smaller allowance is already set. `depositToVaultV2` reads balance + allowance in one multicall and throws a readable error when the amount exceeds the wallet balance.

**Safety checks:** every write passes `chain: base`, so a wallet on another chain is refused instead of signing there. Deposit and withdraw compare the vault asset's on-chain `decimals()` with the registry and throw before sending if they differ. A receipt wait that times out (10 minutes) throws `TransactionStillPendingError` with the hash: `TransactionFlow` shows the Basescan link and no Retry, so a slow transaction is never sent twice. The backup receipt handler only reports success for `status === 'success'`. A force plan whose penalty would burn the whole position is refused (`ForceWithdrawPenaltyTooLargeError`, shown as its own message). A transaction that outlives the 10-minute wait is stored as `pendingTx` in `TransactionContext` (above the review modal, not cleared by `reset`); the review cannot be closed and nothing can be sent while it is set. It keeps being watched, including a wallet speed-up (`onReplaced`: `repriced` counts as the same transaction, `cancelled` / `replaced` as not run). **I checked it on Basescan** clears it for a dropped transaction, which brings back Retry. While watched: a successful vault transaction completes the flow, a revert or a confirmed approval offers Retry. The force path also checks the form's decimals against the vault asset.

**Progress:** `TransactionProgressCallback` — `approving` for approvals, `confirming` for the vault tx (do not treat approval hash as final success).

**Routing:** `TransactionFlow.tsx` calls v2 helpers only.

### Shared transaction utilities — `src/lib/transactionUtils.ts`

- `formatTransactionError`, `isCancellationError`
- Used by `TransactionFlow` error handling

### Transaction orchestration — `TransactionFlow.tsx`

v2-only: `depositToVaultV2` / `withdrawFromVaultV2` / `redeemFromVaultV2` / `forceWithdrawFromVaultV2`. Redeem when amount ≈ max via `shouldUseWithdrawAll` (unless a force plan is active).

**Max withdraw detection:** Compares entered amount to `convertToAssets(fullShares)` via **bigint** `parseUnits` with a tight tolerance (~1 unit at ≤8 dp, or 0.001% of max) → uses redeem path / force redeem.

**Liquidity warning:** Before every withdraw, simulate the plain withdraw/redeem (API instant liquidity can be CDN-stale). If it fails, run the force planner on fresh on-chain state: a plan → `WithdrawLiquidityWarningModal` (force path or Morpho link); shortfall → cap the input; planner says instant covers it → send the plain exit so the wallet shows the real error.

---

## Morpho GraphQL & API routes

**Endpoint:** `https://api.morpho.org/graphql`  
**Deprecation:** Morpho shuts down this GraphQL endpoint on **January 29, 2027**. The REST migration plan (endpoint map, file-by-file, gaps) is in `docs/morpho-rest-migration.md`.  
**Docs:** https://docs.morpho.org/tools/offchain/api/morpho-vaults/

### V2 complete route (`src/app/api/vault/v2/[address]/complete/route.ts`)

Query root: `vaultV2ByAddress(address, chainId)`.

Notable fields: `asset`, `totalAssets`, `totalSupply`, `liquidity`, `liquidityUsd`, `idleAssetsUsd`, `avgNetApy`, `avgNetApyExcludingRewards`, `maxApy`, `adapters`, `rewards`, `warnings`, etc. Governance fields for the Overview: `owner { address }`, `curator { address }` (the `curators` list can be empty while `curator` is set — use the single field), `sentinels`, `timelocks { functionName duration abdicatedAt }`, `maxRate`, `liquidityAdapter`. The route flattens these to `state.owner` / `state.curator` address strings and top-level `sentinels`, `timelocks` (`{ functionName, duration, abdicated }`), `maxRate`, `liquidityAdapterAddress`. Response is normalized toward v1-shaped JSON (`vaultByAddress` shape) for shared UI. Headline APY maps from Morpho **`netApy`** (with fallbacks), matching the Morpho deposit widget.

### V2 history route (`src/app/api/vault/v2/[address]/history/route.ts`)

Query root: `vaultV2ByAddress` → `historicalState`. APY series uses **`avgNetApy` only** (`avgNetApyExcludingRewards` is not on the history type). Maps to `apy` / `netApy` in the JSON response (percent × 100). A bucket with no APY from Morpho is sent as `apy: 0` with `hasApy: false`, and the Overview's average line leaves it out.

### Position history (v2)

- **V1:** `vaultPosition` + `historicalState.{assets,assetsUsd,shares}`
- **V2:** `vaultV2PositionByAddress` + `history.{assets,assetsUsd,shares}`; raw `assets` / `shares` scaled by asset decimals / 1e18 in the route handler

Both return `currentPosition` + `history[]` with `{ timestamp, assets, assetsUsd, shares }`.

### Incomplete Morpho timeseries buckets

Morpho often returns a **trailing interval** (current hour/day) with **zeros** for TVL and/or position while the in-progress bucket is empty. That makes charts dip to zero on the last point.

**Fix:** `stripIncompleteVaultHistoryBuckets` (vault `history` routes) and `finalizePositionHistory` (`position-history` routes) in `src/lib/api-utils.ts` — applied on v2 route responses before JSON is returned.

Brand-new vaults often have TVL/share-price points before Morpho indexes `avgNetApy`. `stripIncompleteVaultHistoryBuckets` keeps those TVL points instead of emptying the series. Overview still hides the APY chart until a positive `apy` exists, and falls back to the hourly 30d series when daily `period=all` is empty.

**`finalizePositionHistory` (position-history only):** uses the live `currentPosition` to disambiguate trailing zeros:

- **Position open** (shares/assets > 0): only zero buckets inside the current interval are stripped (`stripOpenIntervalPositionBuckets`). Earlier zeros stay, so dashboard forward-fill does not carry an old balance across days the wallet was empty. If Morpho has not indexed any history yet, seed a short flat line from the live position. If the indexed series ends at zero while the live position is open, append that live value at now.
- **Position closed** (fully withdrawn): trailing zeros are real → kept. If the series still ends at a **pre-withdrawal value**, a **zero point** is appended one bucket after the last point, so the dashboard's forward-fill aggregation drops to zero instead of being stuck at the last held amount.

### Morpho GraphQL schema changes (2025–2026)

If `complete` routes return **HTTP 400**, validate queries against `https://api.morpho.org/graphql` — invalid fields fail the whole request.

| Removed / renamed | Use instead |
|-------------------|-------------|
| `Asset.priceUsd` | `price { usd }` — use `resolveMorphoAssetPriceUsd()` in `api-utils.ts` |
| `VaultStateReward.yearlySupplyTokens` | Removed — query `supplyApr` only |
| `whitelisted` on Vault / VaultV2 | `listed`. The app does not store it. |
| `state.sharePrice` (v1 VaultState) | Compute from `totalAssets` / `totalSupply` |
| `state.avgApy` (v1) | `avgNetApy` or `apy` |
| `metadata.curators` (v1) | Removed — omit from query |
| `market.uniqueKey` (v1) | `id` (alias as `uniqueKey: id` in query) |
| `historicalState.sharePrice` (v1 VaultHistory) | Removed — derive from `totalAssets` / `totalSupply` in route handler |

**Positions in the UI** use `/api/user/morpho-positions` for Morpho holdings; vault metadata from `/api/vault/v2/.../complete`. Broken GraphQL breaks explorer columns; `WalletContext` falls back to registry metadata when complete fails.

### Caching

`next: { revalidate: MORPHO_GRAPHQL_REVALIDATE_SECONDS }` (60 seconds by default in `constants.ts`) + cache tags like `vault-{address}-{chainId}`.

Per-wallet routes (`morpho-positions`, `position-history`, `earned-interest`, and `activity` with `userAddress`) are `force-dynamic`, read Morpho with `revalidate: 0`, and send `private, no-store`, so charts catch up right after a transaction. Per-wallet activity pages through up to 10 pages so an old deposit is not cut off; the vault-wide feed stays one cached page. `earned-interest` returns 503 (`retryable`) when the Morpho position read fails or a holder's activity fallback fails, so the UI shows a dash instead of 0 earned. `/api/prices` returns 502 when Morpho prices fail; the client keeps the last prices.

`fetchMorphoGraphQL` also keeps a 60s in-memory cache. An expired entry is kept 10 more minutes and served only when Morpho rate-limits. Retries honor `Retry-After` up to 3s; a longer wait returns the error right away so a route handler never hangs. Routes whose body changes every call (the vault `history` route's `endTimestamp`) pass a stable `cacheKey` (vault, chain, period).

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
| `/api/prices` | Morpho USD prices by token address (`?addresses=`) |
| `/api/user/morpho-positions` | User Morpho v2 positions |
| `/api/vault/v2/...` | V2 Morpho GraphQL proxies |

**NavBar:** Dashboard → `/`, Vaults → `/vaults`. Settings: theme (light/dark/auto). Right sidebar (`LearnContent`) is Q&A links to Morpho docs (protocol, Vault V2, curator, Blue, Midnight) and [self-custody](https://muscadine.xyz/self-custody).

**App title:** metadata in `layout.tsx` uses **Muscadine Vaults** (`APP_NAME` in `src/lib/constants.ts`) so the page title and Reown AppKit / WalletConnect match.

---

## Dashboard & vault explorer UI

### Dashboard (`/` — `src/app/page.tsx`)

Adaptive layout (content-sized panels; empty sections omitted):

| Area | Component | Behavior |
|------|-----------|----------|
| Wallet | `WalletOverview` | Full $ amounts; strip width measured live |
| Chart | `PortfolioPositionChart` | Under wallet; ~300–380px height |
| Side | Your Vaults | Vaults when held |

**Responsive wallet / vaults (`useWalletStripNeedsFullWidth`):** On desktop (`min-[1000px]`), compares wallet strip intrinsic width to half the dashboard. If it fits → vaults align with wallet; if too wide (big $ / narrow window) → wallet spans full width and vaults drop to align with the chart. Mobile always stacks (wallet → chart → vaults). Hysteresis avoids flicker on resize. The dashboard is **one grid** whose template changes per layout (`gridStyle` in `page.tsx`); the wallet strip and chart keep their place in the tree, so a layout switch never remounts the chart (a remount refetched every vault's history). Do not go back to separate layout branches.

**Important:** Portfolio chart includes **v2** positions from the API; **Your Vaults** is **v2-only**.

- **Your Vaults** lists v2 deposits only (`position.version === 'v2'`), sorted by USD. External (non-curated) vaults are shown but **not clickable** (no `/vault/v2/...` detail page) and labelled **External**; Muscadine vaults get a **Whitelisted** label only when an external vault is also listed. Hidden when empty.
- **Layout:** Desktop uses two independent columns. Your Vaults sits beside the chart. Wide wallet still uses `wallet|wallet / chart|side`. Below 1000px stacks wallet → chart → Vaults.
- **Portfolio chart** (`PortfolioPositionChart.tsx`):
  1. Discovers vaults via `/api/user/morpho-positions?includeEmpty=true`.
  2. **`aggregatePortfolioHistory()`** in `portfolio-utils.ts` — forward-fill and sum USD.
  - Histories load once this wallet's positions list has resolved (`positionsReady`), keyed by the list of vaults (not the `positions` array), so a same-wallet balance refresh does not refetch them. Retired fee-wrapper addresses are left out of that list and out of Your Vaults, so a leftover wrapper position is not summed beside the strategy vault. Vault page My Position asks for earned interest only once the on-chain balance is known (one request, not one before and one after).
  - **Current holdings** in `WalletOverview` / Your Vaults from **`WalletContext`** (`/api/user/morpho-positions`).
- Preloads vault API data for deposited vaults via `useVaultListPreloader`.
- **Position display:** `formatPositionUsd` / `formatPositionTokenAmount` in `formatter.ts` — USDC **6**, cbBTC/ETH/WETH **8**. Transactions use full chain decimals via `formatBigIntForInput`. Chart axes stay compact (2/6).
- **Your Vaults cells:** columns are Vault 34% and 22% for each value column. Every value cell is one amount line over one USD line (`DashboardStackedValue`, no wrapping, `tabular-nums`). Token amounts use `formatDashboardTokenAmount` (1,000+ compact, stablecoins 2 decimals, others 4 decimals or 4 significant digits below 1), and the full `formatPositionTokenAmount` value is in the hover title.

### Vault explorer (`/vaults` — `src/app/vaults/page.tsx`)

`VaultExplorer` = `VaultExplorerFilters` + `VaultExplorerTable`.

**Filters** (`VaultExplorerFilters.tsx`) — compact `text-xs` controls:

| Filter | Options | Notes |
|--------|---------|-------|
| Network | All, Base | Default **All**; `base` filters `chainId === 8453` |
| Strategy | All + each registry strategy (Prime, Frontier) | Default **All**. Hidden when the registry has one strategy. |
| Asset | All + each registry asset, registry order (USDC, cbBTC, WETH) | Local filter state. Hidden when the registry has one asset. |
| Scope | Deposits + whitelisted, In wallet, **Whitelisted** | Default **Deposits + whitelisted**. Wallet modes can list external deposits as **External** (not clickable). |

**Table columns** (`VaultExplorerTable.tsx`): Network, Vault, **Your Position** (when connected), **Deposits**, **Liquidity**, **APY**. **Whitelisted** rows navigate to `/vault/v2/{address}`; external rows are display-only.

**Vault list sort order** (`sortVaultsForDisplay`): (1) position USD high → low, (2) TVL high → low, (3) name.

**Earned interest:** `useVaultEarnedInterest` for curated vaults; shows **0** when never deposited.

### Vault detail (`/vault/v2/[address]`)

Whitelisted registry vaults only — unknown / external addresses redirect home. Deposit/Withdraw is an inline `VaultTransactPanel` on My Position only, top-aligned with Your Position + Earned Interest (chart under those totals). Overview has no deposit or withdraw bar. Below 1000px: totals → chart → panel. Stats box: Network, APY, Past/Future rewards (no duplicate position or all-time earned). Past is the default when the user has a vault position; Future is the default when they do not. WETH vaults take and pay WETH only. Tab switches away from My Position are blocked while a tx is in preview/signing.

### Vault Overview (`VaultOverview.tsx`) — three layers of detail

The analytics site (`analytics.muscadine.xyz`) is retired; its vault information lives here. It is **not** split into more tabs (Overview / My Position / History stay). Overview is one scroll page; each section leads with a one-line plain-English summary and the detail sits below it.

1. **Key numbers (always visible):** Net APY (with `VaultApyInfo`, no subtitle), Total deposits, and Liquidity (total underlying, `VaultLiquidityInfo`, plus "% of deposits").
2. **Jump links** (`VaultSectionNav`, `VAULT_OVERVIEW_SECTIONS`): Performance · Allocation · Risk · Details, on phones too. They are the bottom row of the vault page's sticky header (`data-vault-sticky-header`, under the tabs, Overview only). The app scrolls inside `[data-app-scroll]`; a jump scrolls that container so the section lands just below the header (`contentTop`). The section in view is highlighted (`aria-current`). Opening Overview highlights Performance. A tapped jump link stays highlighted until the user scrolls away from where it landed, so a section near the bottom (Risk) that cannot reach the header, or content above that grows after the jump, does not move the highlight. Switching tabs after scrolling past the header starts the new tab at its top.
3. **Performance:** chart tabs **APY** → **Total Deposits** → **Share Price** (Allocations is no longer a chart tab). The APY chart draws a dotted **Avg** line at the time-weighted average APY for the selected period (`timeWeightedAverage` in `chart-utils.ts`), as on Morpho's chart. Buckets with no Morpho APY (`hasApy: false`) are gaps the line bridges (`connectNulls`), left out of the average and the y-axis range. All three charts use a numeric time x-axis with evenly spaced ticks (`evenTimeTicks`: every N calendar days at local midnight, N picked so labels fit the measured width via `maxTimeTicksForWidth` and `useElementWidth`); `interval={0}` so Recharts never drops ticks unevenly. **Total Deposits** and **Share Price** support USD / token toggle. Axis labels and tooltips use full values with 2 decimals (`formatCurrency` / `formatAssetAmount`).
4. **Allocation:** the market table only (`VaultAllocations`). No summary sentence and no collateral bar. Name, allocated amount, and APY always show. There is no share column. Market size sits under the market name, not in its own column. If the table would overflow, liquidity drops first, then type. Below 30rem the row is a card with the size under the name, plus type, allocated amount, APY and liquidity. The table shows at most the 5 largest positions above $0.01 (`isAllocationDust`). An idle row (**Unallocated Capital**, APY 0) is always in the data and joins them only while it holds funds. The **Other markets** disclosure opens the rest (smaller positions, dust and every capped market at zero, idle last). Its count is markets only. Fixed-rate market links go to markets.morpho.org (app.morpho.org has no /fixed route). Market names link to Morpho.
5. **Risk** (`VaultRiskFacts`), kept short on purpose: the strategy in one paragraph (`STRATEGY_TEXT`: **Prime** = blue-chip collateral such as BTC / ETH and their wrapped or staked versions, deep markets, conservative LTV; **Frontier** = higher yield, wider crypto and tokenized stocks, lower LTV). Then a three-item **Every market is screened on** box: Collateral (native, wrapped/staked, tokenized stock, redemption), Market liquidity, Oracle and LTV. Then **Pending changes** (below), then links: **View markets on Morpho** (the vault's Morpho page; curator.muscadine.xyz stays private, so it is not linked), **Risk framework** (muscadine.xyz/risk), **Morpho's disclaimer**. No live numbers here: liquidity is in the key numbers, fees / timelocks / roles in Vault details. **Morpho `warnings` are not shown to users** (every vault is unlisted on Morpho); Curator keeps them for risk management. **Pending changes** (`/api/vault/v2/{address}/pending`, Morpho `pendingConfigs`, `mapVaultV2Pending` in `lib/vault-v2-pending.ts`) lists curator changes still in their timelock with a small **+** (adds: adapter, cap raise, fee increase, allocator), **−** (removes: adapter, allocator, fee cut, abdication) or **•** (other) mark and a countdown. Morpho's indexer can keep listing an executed or revoked change, so the route checks each one on the vault (`executableAt(data)` is 0 once it is gone, `dropResolvedOnChain`) and drops it; a failed read keeps Morpho's list. More than 5 changes collapse into a closed dropdown with the count in its title (`PENDING_COLLAPSE_AFTER`). Hidden when nothing is pending or the read fails.
6. **Vault details** (`VaultDetails`, its own section after Risk, jump link **Details**, each part a collapsed `<details>`): Roles (owner, curator, allocators, sentinels with copy + Basescan), Timelocks grouped by delay with **Abdicated** last (`groupTimelocks`; `decreaseTimelock` is hidden because Morpho reports it as no delay, yet cutting a timelock waits out the timelock being changed), Caps in three sections — Markets, Tokens, Adapters (lazy `/api/vault/v2/{address}/caps` on first open; only caps holding funds by default, "Show all" toggle; market rows say Variable or Fixed with LLTV and link to the Morpho market; token rows link to the token on Basescan; the Morpho Blue adapter is labeled "Morpho Blue adapter"; uint128 max = No limit, relative cap 1e18 = No limit), Contracts and limits (vault, liquidity adapter, performance fee and management fee, max rate as %/yr, then **Send-assets gate** (above the links): the vault's `sendAssetsGate` address from `useVaultDepositGates().sendAssetsGates`, or **None** when unset, then Morpho + Basescan links).

Pure helpers and their tests: `src/lib/vault-details.ts` (`__tests__/vault-details.test.ts`), `src/lib/vault-v2-caps.ts` (`__tests__/vault-v2-caps.test.ts`), `src/lib/vault-v2-pending.ts` (`__tests__/vault-v2-pending.test.ts`).

---

## State & context

Provider tree (`src/app/Providers.tsx`):

`ErrorBoundary` → `WagmiProvider` → `QueryClient` → `ThemeProvider` → `AdvisoryAgreementProvider` → `ToastProvider` → `PriceProvider` → `WalletProvider` → `ExplorerVaultsProvider` → `VaultDataProvider` → `TransactionProvider` (Reown AppKit initialized via `createAppKit` in `src/config/appkit.ts`; no SIWE/SIWX)

| Context | File | Role |
|---------|------|------|
| `WalletContext` | `contexts/WalletContext.tsx` | Wallet balances of every registry vault asset (one multicall); Morpho positions via `/api/user/morpho-positions`; refresh after txs |
| `VaultDataContext` | `contexts/VaultDataContext.tsx` | Cached vault metadata from `/api/vault/.../complete` |
| `TransactionContext` | `contexts/TransactionContext.tsx` | Vault transact modal: from/to accounts, amount, status |
| `PriceContext` | `contexts/PriceContext.tsx` | Registry vault assets (on chain) and their Morpho USD prices: `priceOf`, `priceForVault`, `assetForVault` |
| `ToastContext` | `contexts/ToastContext.tsx` | Toasts |
| `ThemeContext` | `contexts/ThemeContext.tsx` | Light/dark |
| `AdvisoryAgreementContext` | `contexts/AdvisoryAgreementContext.tsx` | Legal modal gating |

### Advisory agreement (`AdvisoryAgreementModal.tsx`)

Shown before wallet connect (`ConnectButton` → `AdvisoryAgreementProvider`), titled **Terms and Risks** (the code keeps the `AdvisoryAgreement*` names). Copy is **non-custodial / risk curation only** — not discretionary management or investment advice. Do not call it an advisory agreement in UI copy, and do not name the LLC (the sites say "Muscadine"). Muscadine is a **personal, non-commercial project** (the LLC is dissolved): UI copy never mentions services, clients, an advisory relationship or a company.

**Legal links (canonical URLs):**

| Label | URL |
|-------|-----|
| Terms of Use | https://muscadine.xyz/terms |
| Legal Disclaimer | https://muscadine.xyz/legal |
| Morpho’s Disclaimer | https://morpho.org/disclaimers |
| Privacy Policy | https://muscadine.xyz/privacy |
| Risk Framework | https://muscadine.xyz/risk |
| U.S. economic sanctions (checkbox) | https://ofac.treasury.gov/sanctions-programs-and-country-information |

Same Risk Framework / Morpho’s Disclaimer links appear in the **NavBar** Muscadine dropdown (Protocol section, with Terms / Legal / Privacy). Its first section is **Website** (muscadine.xyz), not Company.

**Morpho Earn UX:** first-interaction copy includes Morpho’s required disclosure (Muscadine Terms + Morpho’s Disclaimer). Same Morpho Disclaimer link is in the NavBar Protocol menu and on review/confirm. Do **not** add a “Powered by Morpho” badge on vault hero, the transact panel, or review — it reads as tacky next to the product UI; the disclaimer links cover attribution.

**Dead shares:** curated vaults already mint inflation-protection shares to `0x…dEaD`. Confirm that **when adding a vault** to `vaults.ts`. Do not RPC-check dead-share balances at runtime (no Alchemy call on `/complete` or elsewhere).

**Re-acceptance:** `TERMS_VERSION` in `AdvisoryAgreementContext.tsx` (currently **`2.9.0`**) — bump when legal copy changes; stored in localStorage as `advisory-agreement-version` alongside `advisory-agreement-accepted`.

**Advisory:** the first-connect modal is short on purpose: one line asking the user to review and accept, then two sentences (personal non-commercial project, open-source, non-custodial, no advice or offer; governed by Muscadine's Terms of Use and Morpho's Disclaimer, yields not guaranteed, deposits can be lost), then one line that a vault can have a deposit gate and performance or management fees, so review a vault's details before depositing. Below them sit the Legal Documents links and the three checkboxes. There is no Company section. Do not link `analytics.muscadine.xyz` (retired).

---

## Key hooks

| Hook | File | Purpose |
|------|------|---------|
| `useVaultEarnedInterest` | `hooks/useVaultEarnedInterest.ts` | All-time earned interest for curated vaults |
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
    appkit.ts             # createAppKit (no SIWE/SIWX; EIP-6963 + featured Base/MetaMask/Rabby/Phantom)
    navigation.tsx        # Nav links (Dashboard, Vaults)
  contexts/               # See table above
  hooks/
  lib/
    portfolio-utils.ts    # ★ aggregatePortfolioHistory (dashboard)
    api-utils.ts          # Period/interval helpers; strip incomplete Morpho timeseries tails
    transactionUtilsV2.ts # ★ V2 on-chain (ERC-4626 + vault multicall force withdraw)
    transactionUtils.ts   # Errors, shared tx helpers
    vaults.ts             # ★ Vault registry (v2 Prime/Frontier)
    vault-utils.ts        # Routes, sortVaultsForDisplay, resolvePositionAssetsUsd, isCuratedVaultAddress
    interest-utils.ts     # Earned interest from activity; period + projected estimates
    asset-decimals.ts     # Morpho amount normalization
    constants.ts          # Chain, WETH, cache TTLs
    registry-assets.ts    # Each registry vault's asset() + decimals/symbol, read on chain
    token-prices.ts       # /api/prices helpers (Morpho prices by address)
    token-metadata.ts     # Runtime token registry (decimals, symbols, Morpho logos)
    abis.ts               # Shared ERC20 balance + ERC4626 convertToAssets
    formatter.ts          # formatCurrency, formatSmartCurrency, formatAssetAmount, …
    logger.ts             # Structured logging
  types/
    vault.ts              # Vault, MorphoVaultData, account types
    transactions.ts       # Progress step types
    api.ts                # API response types
```

---

## UI / transaction UX

**Statuses:** `idle` → `preview` → `signing` | `approving` → `confirming` → `success` | `error`

**Progress steps** (`types/transactions.ts`): `signing`, `approving`, `confirming`.

**Rules:**

- Approval txs use `approving`; only the main vault op should set `confirming` with the hash users care about.
- After success, balances refresh via `refreshBalancesWithPolling` in `TransactionFlow`.

**Vault transact panel** (`VaultTransactPanel.tsx` + `useScopedVaultTransaction`): amount entry stays inline on My Position. After Deposit/Withdraw, review/confirm is the same popup (`Modal` + `TransactionFlow`) as before so addresses and steps are readable. Amounts over balance block the CTA. While the review popup is open (`status !== 'idle'`) the panel hides its amount warnings (over balance, cap reached, over cap, lowered to cap) and the CTA keeps its Deposit / Withdraw label: balances and caps refresh as soon as the transaction lands, so the amount still in the input would otherwise read as "Amount exceeds available balance" behind a successful transaction. Closing the popup clears the amount; the send path re-checks balance and caps. `/transact` redirects to `/vaults`. Opening the panel calls `refreshBalancesIfStale(60s)` (skips when a refresh is running or finished cleanly in the last minute) and a non-forced `fetchVaultData`; form amounts are read on chain regardless.

**Transact tabs:** Tab highlight uses `activeTab` (user selection). `effectiveActiveTab` infers deposit vs withdraw from From/To when both accounts are set (WETH prefs, max amount). `handleTabChange` resets accounts per tab; do not no-op on `tab === activeTab` alone — use `accountsMatchTransactionTab()` so mismatched From/To does not block clicks.

**Portfolio position history:** Per-vault API at `/api/vault/v2/{address}/position-history` (tails stripped server-side). Dashboard runs **`aggregatePortfolioHistory`**; single-vault charts use `VaultPosition.tsx`.

**Formatting conventions:**

- Table/explorer USD pills: `formatSmartCurrency(..., { alwaysTwoDecimals: true })` for compact TVL/deposits.
- Vault detail **Total Deposits chart** (when toggled): `formatCurrency` / 2-decimal token amounts on axis + tooltip — not abbreviated thousands.

---

## Wallet & balances

`WalletContext`:

- Native ETH + every registry vault asset (`readRegistryAssets`), read in one multicall per refresh. USD prices come from Morpho by address (`/api/prices`, `PriceContext`).
- **Morpho positions:** `/api/user/morpho-positions` (v2); metadata from `/api/vault/v2/.../complete`
- `refreshBalances`, `refreshBalancesWithPolling` after transactions

**Privacy (no optional analytics or telemetry):** AppKit `features.analytics: false` (Reown still receives its mandatory `INITIALIZE` / `CONNECT_SUCCESS` events and wallet-list impressions, which cannot be turned off). `src/config/wagmi.ts` registers its own Base Account connector (smart wallet) with `preference: { telemetry: false }` so AppKit skips its default one, whose SDK sends telemetry to Coinbase by default, and its own Coinbase Wallet connector (`@coinbase/wallet-sdk`, id renamed to `coinbaseWallet` so AppKit lists it and does not add its own; `enableCoinbase` stays on). Both are wrapped in `lazyConnector` (`src/lib/lazy-connectors.ts`, `lazyBaseAccount` / `lazyCoinbaseWallet`): wagmi's mount-time `reconnect()` calls `getProvider()` on every configured connector, which would load each SDK (and its COOP `HEAD` request) on every page load. Until the user connects with it, or it was the last connector used and not disconnected, its `getProvider()` returns nothing and `isAuthorized()` is false; `disconnect()` and a disconnect from the wallet side (`onDisconnect`) are remembered (`<id>.disconnected`); `disconnect()` tolerates a provider without `disconnect`. The remembered disconnect is cleared only after a successful connect. `preloadWalletSdks()` fetches both SDK chunks when Connect is clicked (same-origin, starts no SDK) so the first connect's import does not sit between the click and the wallet popup. Tests: `__tests__/lazy-connectors.test.ts`. `@coinbase/wallet-sdk` is pinned to 4.4.0, which has no telemetry (4.3.x did); an `overrides` entry makes AppKit's `@reown/appkit-utils` use the same single copies of both SDKs. The `dev` / `build` / `start` scripts set `NEXT_TELEMETRY_DISABLED=1`, so Next.js build telemetry is off locally and on Vercel. AppKit's `--apkt-font-family` / `--w3m-font-family` are `inherit`: the modal is mounted under `<body>` and uses our self-hosted Figtree. Do not use `var(--font-…)` there (AppKit declares it on `:root`, where next/font's variable is undefined). Any custom value also stops AppKit preloading its fonts from `fonts.reown.com` on every page load. No analytics packages. Keep it that way: do not add an SDK or option that sends usage data unless it is required for the feature.

---

## Wallet UIs and app identity

Plain web app on Base, like Fintech-vault-project: no Base App / mini-app integration (no `base:app_id` meta tag, Base App WebView connect path or ERC-8021 builder code), no Farcaster manifest. `APP_NAME` (**Muscadine Vaults**) lives in `src/lib/constants.ts`; AppKit `metadata` in `src/config/wagmi.ts` sets `url: getAppUrl()` and `icons: [appUrl + '/favicon.png']`. Inside the Base App or any wallet browser, Connect opens Reown AppKit like everywhere else. Injected wallets appear through EIP-6963, except the Coinbase extension: our Coinbase connector shares its rdns (`com.coinbase.wallet`), so wagmi hides the announcement and the **Coinbase** row (Coinbase Wallet SDK) uses the extension when installed. **Base (formerly Coinbase Wallet)** is the Base Account smart wallet. Layout uses `dvh`. Do not CSS-elevate leftover AppKit dialog siblings.

---

## Configuration & constants

`src/lib/constants.ts`:

- `BASE_CHAIN_ID = 8453` — use this constant; never write `8453` inline
- `MORPHO_CHAIN_SLUG` / `getMorphoChainSlug` — chain slug for app.morpho.org links
- `BASE_WETH_ADDRESS` — Base canonical WETH
- Cache TTLs: vault client + Morpho in-memory **60s**; prices 60s server / refetch every 5 min; activity 1m
- Morpho GraphQL: `MORPHO_GRAPHQL_URL`, `MORPHO_GRAPHQL_REVALIDATE_SECONDS`, fetch timeout/retries, preload batch size — all Morpho calls go through `fetchMorphoGraphQL()` in `api-utils.ts`

`next.config.ts`:

- Webpack/Turbopack aliases for `wagmi` and `@tanstack/react-query` (singleton React Query context)
- Externals: `pino-pretty`, `lokijs`, `encoding`
- Redirect: `/transact` → `/vaults` (308)

### Deposit gates (read from each vault)

There is no allowlist in the app. `useVaultDepositGates` reads every registry vault on Base as soon as the app loads, and again for the wallet as soon as it connects. It calls `canSendAssets(wallet)`, the same check `deposit` runs for the sender. `canReceiveShares` is abated on every registry vault, so the app does not read it. `canSendAssets` returns true when `sendAssetsGate` is unset, so removing or swapping that gate needs no app change or redeploy.

- **Not whitelisted:** when a successful read says no, the transact panel says the wallet is not whitelisted and to request access at muscadinelabs@gmail.com (`DEPOSIT_GATE_MESSAGE` / `ACCESS_REQUEST_EMAIL` in `vault-gates.ts`; the panel renders that one message with the email as a link, and `TransactionFlow` shows it unchanged as the send-time error), and the CTA reads **Not whitelisted to deposit** (a paused or deprecated vault reads **Deposits are disabled** instead). The vault page passes `depositGateBlocked` down to the panel; every app-facing email uses `ACCESS_REQUEST_EMAIL`.
- **Deposit:** opens only after a successful read says yes. A vault with `sendAssetsGate` unset is open to everyone, including disconnected visitors. While the read loads, the vault page waits and deposits stay off. A failed read keeps it closed. A wallet that cannot deposit can still open a vault it holds shares in; deposit is disabled and withdraw stays open.
- **Send-time check:** `depositToVaultV2` re-reads `canSendAssets` (`isWalletDepositBlocked`) before any approval. A successful no throws `VaultDepositBlockedError`, and `TransactionFlow` refreshes the gate queries so the button disables. A failed read does not block. Gate queries also refetch on window focus.
- **Explorer list:** every registry vault (see Vault registry → Explorer visibility). While the gate reads load, the explorer shows a skeleton. Eligibility is `resolveDepositEligibility` in `vault-gates.ts`.

| Piece | Location |
|-------|----------|
| Gate ABI + batched reads | `src/lib/vault-gates.ts` |
| Hook (vault + wallet queries, 30s stale) | `src/hooks/useVaultDepositGates.ts` |
| Explorer list | `src/contexts/ExplorerVaultsContext.tsx` |

Curator still manages who is whitelisted on `WhitelistSendAssetsGate` (`npm run gates:verify`, `curator/docs/deposit-gates.md`). The app picks up changes on its next read.

### Deposit caps (read from each vault)

Vault V2 `maxDeposit` always returns 0, so the app computes capacity itself (`src/lib/deposit-capacity.ts`). A deposit allocates through the vault's `liquidityAdapter`, and every id the adapter returns must stay within its caps: `absoluteCap > 0`, `allocation <= absoluteCap`, and, unless `relativeCap == WAD`, `allocation <= firstTotalAssets * relativeCap / WAD`. `firstTotalAssets` is the accrued total *before* the deposit (`accrueInterestView`), so a deposit does not raise its own relative limit.

- **Market adapter:** ids are adapter, collateral token and market (`ids(marketParams)`). The allocation change is the deposit plus interest not yet booked (`expectedSupplyAssets − allocation(marketParams)`).
- **Any other liquidity adapter** (empty `liquidityData`, e.g. a vault adapter) is not supported: the read throws, which the UI and send path treat as unknown, not full. Every registry vault uses a market adapter.
- **No liquidity adapter:** deposits stay idle and no cap applies (`null`).

UI and send path:

- `useVaultDepositCapacity` reads as soon as the deposit tab is open (15s stale, refetch every 30s), so the cap is usually known before the user finishes typing. The input cap is 99.9% of headroom (`DEPOSIT_CAP_BUFFER_BPS = 10`) so interest accrued before the tx lands still fits. A market-adapter vault is 3 sequential RPC rounds (multicalls).
- **MAX** fills the lower of the wallet balance and the buffered cap. Typing above the cap shows a warning. Pressing **Deposit** uses the cached cap if it is under 15s old, otherwise re-reads it; if the amount is still above it, the amount is lowered to the buffered cap and the form stays open with a note. At 0 headroom the button reads **Deposit cap reached**.
- `depositToVaultV2` re-reads raw headroom before any approval. An amount above it throws `DepositCapExceededError` (after the gate checks, so a blocked wallet sees the gate message). `TransactionFlow` lowers the amount, shows the error, and **Retry** returns to review with the new amount.
- A failed capacity read never blocks a deposit; the chain still enforces the caps. `formatTransactionError` maps `AbsoluteCapExceeded`, `RelativeCapExceeded` and `ZeroAbsoluteCap` to a readable message.

---

## Development

### Commands

```bash
npm run dev      # Turbopack dev server
npm run build
npm run lint
npm test         # Vitest unit tests (src/**/*.test.ts)
npm start        # Production server
```

**CI** (`.github/workflows/ci.yml`, Node 26): `npm run lint` only. Do not run `npm run build` on GitHub — `wagmi.ts` requires `NEXT_PUBLIC_ALCHEMY_API_KEY` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` at module load, and those keys stay in local `.env` / Vercel, never in the repo or GitHub Actions. Production build is Vercel. Vercel runs Node 26 (`package.json` `engines` `26.x`).

### Turbopack chunk error

If you see `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` after mixing `build` and `dev`:

```bash
rm -rf .next .turbo && npm run dev
```

### Adding a vault

1. Add to `src/lib/vaults.ts` with `version: 'v2'` and `strategy` (`prime` | `frontier`).
2. Confirm Morpho GraphQL returns it (`vaultV2ByAddress`).
3. Confirm the vault has Morpho dead-share inflation protection (minted to `0x…dEaD`) before listing — we do not RPC-check this at runtime.
4. v2 writes require no change in `transactionUtilsV2` if address is passed dynamically — registry drives UI labels and routing.

### Changing v2 transaction behavior

Edit **`src/lib/transactionUtilsV2.ts`** and **`src/lib/force-withdraw-v2.ts`**. Deposits, withdraws, and force exits call the vault directly and pay the vault asset. Test approve → deposit and withdraw/redeem on Base with small amounts.

---

## Dependency constraints

Do not bump without checking compatibility:

| Package | Constraint |
|---------|------------|
| `wagmi` / `@wagmi/core` / `@wagmi/connectors` | **3.x / 3.x / 8.x**, pinned exact and matched in `overrides`. Bump together with Reown AppKit: AppKit 2.x peers `wagmi` / `@wagmi/core` ≥3 and `@wagmi/connectors` ≥8. wagmi 3 API names: `useConnection` (not `useAccount`), `useConnectors` (not `useConnect().connectors`), and `mutate` / `mutateAsync` on mutation hooks (`useConnect`, `useSwitchChain`, `useWriteContract`, `useSendTransaction`) instead of `connectAsync` / `switchChainAsync` / `writeContractAsync` / `sendTransactionAsync`; the old names are deprecated aliases. `useBalance` has no `formatted` field (use viem `formatUnits(value, decimals)`). |
| `@reown/appkit` / `@reown/appkit-adapter-wagmi` | **2.x**, same version for both. Its Base Account, Coinbase Wallet and Safe connectors load SDKs that are optional peers of `@wagmi/connectors` 8 (a direct dep, `$` override). `@base-org/account` 2.6.0 and `@coinbase/wallet-sdk` 4.4.0 are direct deps; the `@reown/appkit-utils` override dedupes AppKit's nested copies onto them. Import connectors from their subpaths (`@wagmi/connectors/baseAccount`), not the barrel. |
| `typescript` | Stay on **6.x** — `typescript-eslint` (via `eslint-config-next`) peers `typescript <6.1.0` |
| `@types/node` | Match the Node major in `engines` (**26.x**) |
| `eslint` | Stay on **9.x** until `eslint-plugin-react` / `jsx-a11y` / `import` (bundled by `eslint-config-next` 16) accept ESLint 10 — their peer ranges stop at 9 and `npm ls` reports the tree invalid on 10 |
| `valtio` | Keep a **root** `valtio` (2.x) — Reown AppKit / WalletConnect must resolve `valtio/vanilla` under Turbopack |
| `@morpho-org/*-wagmi` 4.x | Not used; check its wagmi peer range before adding |

---

## Code conventions

- TypeScript, `@/` → `src/`
- `'use client'` on interactive / wagmi components
- Minimize scope; keep v1 and v2 paths separate
- Use `logger` from `lib/logger.ts` instead of ad-hoc `console.log`. `error` / `warn` always log; `info` / `debug` are development-only.
- Resolve a vault from `vaults.ts` via `findVaultByAddress`
- **Git:** commits, feature branches, pushes of those branches and PRs are fine; never push to or merge into `main` (see Working agreement)
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

3. **`@morpho-org/morpho-sdk` for v2** — optional for Permit/Permit2 and **in-kind redemption** (`inKindRedeem`). Peer dep is viem only.
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
| Morpho timeseries tail fix | `api-utils.ts` (`stripIncompleteVaultHistoryBuckets`, `stripOpenIntervalPositionBuckets`, `finalizePositionHistory`), used in vault `history` + `position-history` routes |
| Position table formatting | `formatter.ts` (`formatPositionUsd`, `formatPositionTokenAmount`, `formatDashboardTokenAmount`) |
| Vault explorer page | `src/app/vaults/page.tsx`, `VaultExplorer*.tsx` |
| V2 deposit/withdraw/redeem | `src/lib/transactionUtilsV2.ts` |
| Force-withdraw planner | `src/lib/force-withdraw-v2.ts` |
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
