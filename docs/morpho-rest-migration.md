# Morpho GraphQL → REST migration (app) — done

Morpho shuts down `https://api.morpho.org/graphql` on **January 29, 2027**; its
deprecation warnings give **2027-01-25** as the removal date for every field, so
treat Jan 25 as the deadline. The app no longer calls GraphQL: every Morpho read
goes through Morpho REST (`src/lib/morpho-rest.ts`) or the chain.

Sources: migration guide https://docs.morpho.org/developers/api/migrate-from-graphql/,
REST reference https://docs.morpho.org/api/, OpenAPI https://docs.morpho.org/openapi.json.
Checked live against GraphQL on all four registry vaults and a real holder on
2026-11-25 (numbers below).

This file is also the scaffolding for later: section 3 lists what REST does not
have, what the app does instead, and exactly what to change if Morpho adds it.
**Before touching a gap, re-check the OpenAPI spec**: Morpho is still adding
routes. No paid RPC plan or indexer is used (decision 2026-11-25), so a feature
REST cannot serve stays dropped until Morpho adds it.

---

## 1. How Morpho is read now

| Piece | File | Notes |
| --- | --- | --- |
| HTTP client | `src/lib/morpho-rest.ts` | `morphoRestGet` / `morphoRestList` (cursor paging, max 20 pages, throws rather than return a cut list). 60s Next data cache + in-memory cache, in-flight dedupe, retries on 429/502/503/504 honouring `Retry-After` up to 3s, a rate limit or outage serves the last good response for 10 min. `revalidate: 0` = always fresh (per-wallet reads). `MorphoRestError` carries `status` and `rateLimited`. Optional server-only `MORPHO_API_KEY` switches to `private.api.morpho.org` (`x-api-key`). |
| Typed reads | `src/lib/morpho-rest-data.ts` | Vault (5 min), state (60s), allocations (60s), roles (5 min), token (1h), price (60s), market params (1h), market state (60s). Helpers: `marketSupplyApy`, `managementFeePerYear`, `wadToFraction`, `adapterTypeName`, `allRestCaps`. |
| Per-wallet reads | `src/lib/morpho-rest-wallet.ts` | Position, performance (profit), position history, activity. Never cached. |
| Market details | `src/lib/vault-v2-markets.ts` | `loadMarketDetails` (params, tokens, state, supply APY), `loadPrices`. |

| Route | REST endpoints |
| --- | --- |
| `/api/prices` | `/v0/tokens/{t}/price` (spot) + `/v0/tokens/{t}` (logo), per token |
| `/api/user/morpho-positions` | `/v0/vaults-v2/users/{u}/positions?chain_ids=&active_only=`, then per row `/v0/vaults-v2/{v}` (name, asset), price, and `/position/performance` (open positions only) |
| `.../earned-interest` | `/position`, `/position/performance` (`net_earnings_assets`), vault, price; activity fallback unchanged |
| `.../position-history` | `/position/history?lookback=` + `/position` (live tip) + vault + price |
| `.../activity` | `/position/activity` (wallet only); transfers valued from `/state/history` totals |
| `.../complete` | `/v0/vaults-v2/{v}`, `/v1/vaults-v2/{v}/state`, `/allocations`, `/sentinels`, `/allocators`, price, each funded market's params + state |
| `.../history` | `/state/history?lookback=` + `/apy/history?lookback=` + vault + price |
| `.../allocations` | `/allocations` + each listed market's params, tokens and state |
| `.../caps` | `/allocations` (market, token and adapter caps) + market params + token symbols |
| `.../pending` | `/pending-governance-actions` → tx receipts → `Submit` calldata → `executableAt` (chain); fees from the vault, labels from `/allocations` + markets |

Period → REST `lookback` (`POSITION_LOOKBACK` in `api-utils.ts`): 7d →
`seven_days` (hourly), 30d → `thirty_days` (daily), 90d → `ninety_days` (daily),
1y and all → `inception` (daily; `one_year` is weekly, so 1y keeps the last year
of inception). Position history for 30d also reads `seven_days` and uses it for
the last week, because the vault page and dashboard cut their 7D chart from the
30d series. REST ends a history with an off-grid point at "now"; the position
route drops it (the live tip from `finalizePositionHistory` covers it).

---

## 2. Trade-offs (accepted 2026-11-25)

| Area | GraphQL had | Now | Size of the difference (2026-11-25) |
| --- | --- | --- | --- |
| Headline net APY | `netApy`, instant | Computed (`instantGrossApy` in the complete route): each funded market's supply APY (Adaptive Curve IRM from REST market state, `marketSupplyApy`) weighted by the vault's live supply, over total assets, then `× (1 − performance fee) − management fee`. Falls back to REST `apy-averages?lookback=six_hours` if a market's APY is unknown (non-Adaptive-Curve IRM). | Within 0.02 pp of GraphQL on all four vaults; can be fresher than GraphQL's vault figure (GraphQL's vault `netApy` lagged a market move by minutes). |
| Market supply APY (allocation table) | `netSupplyApy` | `marketSupplyApy` from REST state, rate at target as of the last accrual (same as Morpho's own figure; adapting it for the time since overstated a market that had not accrued in 2 days by 30%). Other IRMs: REST 6h average. | Within 0.03 pp. |
| Rewards | `rewards`, APY with rewards | Not in REST (Merkl has its own API). Rewards are 0; no registry vault has any. | — |
| USD values | Per-point `*Usd` with historical prices | Spot price × amount everywhere, history included. Fine for USDC; cbBTC / WETH history is valued at today's price. | — |
| Vault APY chart | `avgNetApy` per bucket | REST `apy/history` points are **trailing averages**: `seven_days` → 1-day, `thirty_days` → 7-day, `ninety_days` / `inception` → 30-day. The chart is smoother. | — |
| Vault 30D charts | Hourly | Daily (`thirty_days`). 7D stays hourly. | — |
| Force-deallocatable liquidity | `forceDeallocatableLiquidity` | Computed: for each funded market except the liquidity route, min(vault supply, market cash). A failed market read counts as 0. | Matches to the raw unit (± interest since indexing). |
| Instant liquidity, idle, totals | GraphQL fields | `/state` `withdrawable_assets`, `idle_assets`, `total_assets`. | Exact. |
| Positions, profit | `vaultV2Positions`, `pnl` | `/users/{u}/positions` + `/position/performance`. | Exact (same `pnl`). |
| Vault `warnings`, `listed`, `metadata` | Fields | Not in REST. Not shown to users anyway. | — |

---

## 3. Dropped until Morpho adds them

Each entry: what is gone, what the app does now, and what to restore.

### 3.1 Vault-wide activity feed

- **Gone:** the History tab's "Show All" (every wallet's deposits / withdrawals
  in the vault) and what a disconnected visitor saw there. GraphQL
  `vaultV2transactions` without a user had it; REST only has
  `/v0/vaults-v2/{v}/users/{u}/position/activity`. Reading `Deposit` /
  `Withdraw` / `Transfer` logs on chain needs `eth_getLogs` over a long block
  range, which the free Alchemy tier (10 blocks per call) cannot do.
- **Now:** History is the connected wallet's own activity only.
  Disconnected: "Connect a wallet to see your transactions in this vault". The
  activity route returns 400 without `userAddress`, and
  `fetchVaultV2ActivityData` returns `VAULT_WIDE_ACTIVITY_UNAVAILABLE`.
- **To restore** (when REST has e.g. `/v0/vaults-v2/{v}/activity`):
  1. In `src/lib/vault-v2-activity.ts`, read it when `userAddress` is absent
     (same row shape as the wallet route: `type`, `data.assets` / `shares`,
     `tx_hash`, `log_index`, `timestamp`; keep `user` from the row's account).
  2. In the activity route, accept a missing `userAddress` again and cache that
     response publicly (`s-maxage=60`).
  3. In `VaultHistory.tsx`, bring back the Show All / Show Mine toggle and the
     account column for other wallets (removed in this migration; see git
     history of that file).

### 3.2 Rewards APR

- **Gone:** reward APR in the APY breakdown (`rewardsApr`, `rewards`).
- **To restore:** read Merkl's API (or a Morpho REST rewards route if one
  appears) in the complete route, fill `state.rewards` and raise
  `state.avgNetApy` above `netApyWithoutRewards` by the reward APR.

### 3.3 Historical USD prices

- **Gone:** per-point USD at that day's price.
- **To restore:** if REST adds a historical price route, price each point in the
  `history` and `position-history` routes (`toUsd`) at its timestamp.

---

## 4. Keeping it healthy

- REST silently ignores unknown query params: check names against the spec.
- Amounts are integer strings in base units; `share_price_ray` is
  decimals-adjusted (1.04 × 1e27 for a USDC vault worth 1.04 USDC a share), so
  raw share → asset conversions use `total_assets / total_supply`, never the ray.
- `management_fee_wad` (vault) and `setManagementFee` calldata are **per second**;
  multiply by 31,536,000 for the yearly rate the UI shows.
- Public host limit: 750 req/min per IP; 3,334 in 10 min blocks the IP for 7 days.
  Vercel IPs are shared. If 429s show up, request a key and set `MORPHO_API_KEY`.
- A cold vault page is roughly: complete 6 + markets, allocations 3 + 2 per
  market, caps the same (shared cache), pending 3 + receipts. All cached 60s on
  the server, so repeat views cost nothing upstream.
