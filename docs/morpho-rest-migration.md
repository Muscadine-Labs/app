# Morpho GraphQL → REST migration (app) — work in progress

Morpho is shutting down `https://api.morpho.org/graphql` on **January 29, 2027**.
Every Morpho read in this app goes through it (`fetchMorphoGraphQL()` in
`src/lib/api-utils.ts`), so all of them have to move to the REST API before then.

Sources (reviewed 2026-11-19):

- Migration guide: https://docs.morpho.org/developers/api/migrate-from-graphql/
- REST reference: https://docs.morpho.org/api/
- OpenAPI spec (v1.0): https://docs.morpho.org/openapi.json

The paths and fields below come from that spec. They were also called live
against mpUSDC (`8453:0x8971…b496`) on 2026-11-19.

> **Work in progress.** This plan is a draft and will change: Morpho is still
> adding REST fields, and nothing below is decided. No code has changed yet.

---

## 1. The new API at a glance

| Topic | REST |
| --- | --- |
| Base URL | `https://api.morpho.org` (public, no key). `https://private.api.morpho.org` takes an API key in the `x-api-key` header (request one at docs.morpho.org/request-api-key). |
| Versioning | Most routes are `/v0/...`. Only `/v1/vaults-v2/{v}/state` and `/v1/vaults-v2/{v}/apy-averages` are `/v1`. |
| Selectors | A vault or token is `8453:0xAddress`. A Blue market is `8453:0xMarketId`. |
| Envelope | The result is under `data`. Lists add a top-level `cursor` (`null` on the last page). Send it back unchanged and never build or parse one. |
| Limits | Public host: 750 req/min **per IP**. Going over returns 429 with `Retry-After: 600`. Above 3,334 req / 10 min the IP is blocked for 7 days, so the **sustained** ceiling is about 333 req/min, not 750. An API key raises the limits. |
| Unknown params | Silently ignored, so check every query param name against the spec. |
| Amounts | Integer strings in base units. Parse them with `BigInt`. |
| Fees / LLTV | `*_wad` strings (1e18 = 100%). `management_fee_wad` is **per second**: multiply by 31,536,000 for a yearly rate. `null` = no fee. |
| Share price | `share_price_ray` (divide by 1e27). |
| APY | Decimal fraction (0.0463 = 4.63%), nullable. Rewards are **not** included (Merkl has its own API). |
| Timestamps | Unix seconds. Most are integers, but token price `timestamp`, `last_indexed_block`, activity `block_number` and every `*_block_number` are **strings**. |
| USD | **Gone.** There are no `*Usd` fields. Compute USD from `/v0/tokens/{t}/price`, one token per call, no batch. There is no historical price route. |

**Rate limit risk:** Vercel serverless IPs are shared, and REST needs more calls
than GraphQL did (one GraphQL query becomes 3–5 REST calls). Get an API key for
production and read it server-side only (e.g. `MORPHO_API_KEY`, never `NEXT_PUBLIC_`).

---

## 2. File-by-file plan

| File / route | GraphQL today | REST replacement | Notes |
| --- | --- | --- | --- |
| `src/lib/api-utils.ts` (`fetchMorphoGraphQL`) | POST `/graphql` with retries, a 60s memory cache, stale-on-429 | New `fetchMorphoRest(path, { cacheKey, revalidate })` | Keep the retry, `Retry-After`, stale-on-429 and in-memory cache behaviour. Delete the GraphQL helper once nothing calls it. |
| `src/lib/constants.ts` | `MORPHO_GRAPHQL_URL`, `MORPHO_GRAPHQL_REVALIDATE_SECONDS` | `MORPHO_API_URL` (+ optional private host when a key is set) | |
| `api/prices` (`assets(where: { address_in })` → `price { usd }`, `logoURI`) | One batched query | `GET /v0/tokens/{8453:addr}/price` → `price` (number, nullable) and `GET /v0/tokens/{8453:addr}` → `logo_uri`, `decimals`, `symbol` | One call per token (3–4 registry tokens). Cache the logo longer than the price. A `null` price keeps the current fallback (stablecoin $1, else 0). |
| `api/user/morpho-positions` (`userByAddress` → `vaultV2Positions`) | Positions + `pnl` in one query | `GET /v0/vaults-v2/users/{u}/positions?chain_ids=8453&active_only=false` (the same as `includeEmpty`) | Max 100 rows per page (cursor). The rows carry no `pnl`: call `/position/performance` per vault (below) and no name or USD (the registry, `/complete` and prices give those). Non-registry vaults need `GET /v0/vaults-v2/{v}` for name/asset. |
| `api/vault/v2/[address]/earned-interest` (`vaultV2PositionByAddress` → `pnl`) | `pnl` | `GET /v0/vaults-v2/{v}/users/{u}/position/performance` → `net_earnings_assets` (average-cost method) | Keep the activity fallback, built from `/position/activity`. |
| `api/vault/v2/[address]/position-history` (`vaultV2PositionByAddress.history`) | `assets`, `assetsUsd`, `shares` | `GET /v0/vaults-v2/{v}/users/{u}/position/history?lookback=` → `{timestamp, shares, assets}` | No `assetsUsd`: multiply by the current price (good enough for USDC; cbBTC / WETH history becomes spot-priced). `finalizePositionHistory` stays. Map our periods to `lookback` (`seven_days`, `thirty_days`, `ninety_days`, `one_year`, `inception`). |
| `api/vault/v2/[address]/complete` (`vaultV2ByAddress`) | Name, asset, totals, liquidity, APY, owner/curator/sentinels, timelocks, maxRate, liquidityAdapter, fees, rewards, warnings | `GET /v0/vaults-v2/{v}`: `name`, `symbol`, `asset`, `owner`, `curator`, `governance.timelocks[]{function_name, timelock_seconds, is_abdicated}`, `max_rate_per_second_wad`, `liquidity_adapter`, `liquidity_data`, fees, `gates`.<br>`GET /v1/vaults-v2/{v}/state`: `total_assets`, `total_supply`, `withdrawable_assets` (= GraphQL `liquidity`), `idle_assets`, `share_price_ray`.<br>`GET /v1/vaults-v2/{v}/apy-averages?lookback=one_day` → `apy`.<br>`GET /v0/vaults-v2/{v}/sentinels`, `/allocators` → `role_address[]`.<br>Token price for `totalAssetsUsd` / `liquidityUsd`. | 5–6 calls instead of 1. Run them in parallel and cache the result as one unit. **There is no instant `netApy`.** Pick a lookback (`one_day` or `six_hours`) and say "24h avg" in the UI if needed. `rewards` → Merkl or drop it (no registry vault has rewards today). `warnings` is not shown to users, so drop it. `maxRate`: per-second WAD × 31,536,000. |
| `api/vault/v2/[address]/history` (`historicalState` TVL / APY / share price) | `totalAssets(Usd)`, `avgNetApy` | `GET /v0/vaults-v2/{v}/state/history?lookback=` → `total_assets`, `share_price_ray`, `withdrawable_assets`, `idle_assets`.<br>`GET /v0/vaults-v2/{v}/apy/history?lookback=` → `{timestamp, apy}` | Sampling depends on `lookback` (live mpUSDC, 2026-11-19): `one_day` / `seven_days` hourly, `thirty_days` / `ninety_days` daily, `one_year` **weekly**, `inception` picked by age (daily today; can become monthly). **`apy/history` points are trailing averages, not per-bucket APY:** `seven_days` returns 1-day averages, `thirty_days` 7-day averages, `ninety_days` / `inception` 30-day averages. So the Overview APY chart and its "Avg" line would show smoothed values: pick lookbacks and labels deliberately. Today's hourly 30d fallback has no REST equivalent (`thirty_days` is daily). Historical USD TVL needs a price source: spot × tokens, or DefiLlama. The `hasApy: false` gap handling stays (`apy` is nullable). Check `stripIncompleteVaultHistoryBuckets` still applies. |
| `src/lib/vault-v2-historical-ratio.ts` | `historicalState` | `state/history` (share price / totals) | |
| `src/lib/vault-v2-caps.ts` + `api/.../caps` | `adapters`, `caps` | `GET /v0/vaults-v2/{v}/allocations` → `allocations[]{adapter_address, adapter_kind, caps[]{cap_type, absolute_cap, relative_cap_wad, allocated_assets, market_id?}}` + `unscoped_caps[]` (collateral caps) | `absolute_cap` = 2^256−1 means "No limit" (we test uint128 max today, so handle both). Market names need `/v0/blue/markets/{m}` (no symbols, only token addresses → `/v0/tokens/{t}`). |
| `src/lib/vault-v2-allocations.ts` + `useVaultAllocations` + `api/.../allocations` | Positions per market with `supplyApy`, `liquidityUsd`, market size | `/allocations` (`allocated_assets` / `expected_supply_assets` per market cap), plus per market `GET /v0/blue/markets/{m}/state` (size = `total_supply_assets`), `/liquidity` (`market_liquidity`), `/apy-averages` (`supply_apy_averages['24h']`) | About 3 calls per market. Cache hard (60s) and only fetch the top rows plus "Other markets" on open, if needed. |
| `src/lib/vault-v2-pending.ts` + `api/.../pending` (`pendingConfigs`) | `functionName`, `data`, `validAt` | `GET /v0/vaults-v2/{v}/pending-governance-actions` → `action_type`, `parameters`, `executable_at_timestamp`, `submitted_transaction_hash` | `action_type` gives most +/−/• marks (`add_adapter`, `increase_absolute_cap`, …), but `set_performance_fee` / `set_management_fee` carry no direction: compare with the current fee. **There is no raw calldata**, so `dropResolvedOnChain` (`executableAt(data)`) has to re-encode calldata through an `action_type` → function map plus `parameters` (`id_data` for cap increases), or be dropped. `parameters.selector` exists only on timelock / abdicate actions and is the function being changed, not the submitted call. `unknown` actions have `parameters: null` and cannot be re-encoded. Cap decreases are not timelocked and never appear. |
| `src/lib/vault-v2-activity.ts` + `api/.../activity` (`vaultV2transactions`) | Per-wallet history **and** a vault-wide feed | Per wallet: `GET /v0/vaults-v2/{v}/users/{u}/position/activity?limit=1000` (`type` = deposit / withdraw / shares_transfer_in / shares_transfer_out, `data.assets` / `data.shares`) | **Gap: there is no vault-wide activity route.** Drop the vault-wide feed or read vault events on chain. Transfer rows carry shares only (no assets). USD per row = current price. |

Nothing changes for on-chain reads (balances, deposit gates, caps, force
withdraw); those already use RPC.

---

## 3. Gaps (nothing in REST)

1. **Vault-wide activity feed** (`vaultV2transactions` without `userAddress`).
2. **Instant net APY.** Only window averages are available; the shortest is `one_hour`.
3. **USD values and historical prices.** Spot only, one token per call.
4. **Vault `warnings`, `rewards`, `listed`, `metadata.description`.** None are used in the UI today except rewards (always empty).
5. **Pending calldata.** Only decoded `parameters`.

---

## 4. Suggested order

1. Get a Morpho API key. Add `MORPHO_API_KEY` to `.env.example` / Vercel. Build `fetchMorphoRest`.
2. `api/prices` (smallest, standalone).
3. `morpho-positions`, `earned-interest`, `position-history` (wallet data).
4. `complete` + `history` (vault page, explorer).
5. `caps`, `allocations`, `pending`, `activity`.
6. Remove `fetchMorphoGraphQL`, the GraphQL constants, and the schema-drift table in `CLAUDE.md`. Update `CLAUDE.md` / `AGENTS.md`.

For each step, compare old and new responses on all four registry vaults and a
real wallet before switching. Run `npm run lint`, `npm test` and `npm run build`.

---

## 5. Proposed approach: hybrid on-chain + REST (under consideration)

> **Not decided.** This is the direction we are leaning toward. Morpho is
> still adding fields to the REST API (instant APY, USD values or vault-wide
> activity may arrive before the shutdown), so re-check the OpenAPI spec before
> building and move anything REST starts covering back to REST if that is simpler.

Idea: read **current state on chain** in a few batched multicalls, cache it on
the server, and share it across routes. Use **Morpho REST only for history and
per-wallet history**, which the chain cannot give cheaply. Goal: as few calls as
possible.

### 5.1 On-chain vault snapshot (all registry vaults, about 3 `eth_call`s)

One server module (e.g. `src/lib/onchain/vault-snapshot.ts`) reads every
registry vault in the same multicall, in dependent rounds:

| Round | Reads |
| --- | --- |
| 1 | `totalAssets`, `totalSupply`, `asset`, fees, `maxRate`, owner, curator, `liquidityAdapter` / `liquidityData`, adapter list, idle (`asset.balanceOf(vault)`) |
| 2 | Each adapter's funded markets (`marketIds(i)`); `absoluteCap` / `relativeCap` / `allocation` per cap id (ids from REST `/allocations`, see below); live adapter position (`realAssets` / `expectedSupplyAssets`) |
| 3 | `Morpho.market(id)` (totals, fee) + IRM `borrowRateView` per market; Chainlink USD feeds for the vault assets |


Verified on chain (mpUSDC, 2026-11-19): `adaptersLength` / `adapters(i)`,
`liquidityAdapter`, `timelock(selector)`, `abdicated(selector)` and the
adapter's `realAssets` all read fine. The Blue market adapter lists markets
with `marketIds(i)` / `marketIdsLength()`, but **only markets that hold funds**
(2 of the vault's 5 market caps). Capped-but-empty markets and collateral caps
cannot be enumerated on chain, so the **cap id list comes from REST
`/allocations`** (cached about 1h). Values are then read on chain, and market
params from `Morpho.idToMarketParams(id)`.

What it computes:
- TVL and liquidity (+ USD).
- Instant market APY: borrow APY = e^(`borrowRateView` × 31,536,000) − 1 (`borrowRateView` is a per-second WAD rate); supply APY = borrow APY × utilization × (1 − fee).
- Vault net APY: allocation-weighted supply APY after fees. This excludes Merkl rewards; no registry vault has rewards today.
- Caps and allocations.

The `complete`, `caps`, `allocations` and `prices` routes all read this one object.

Call efficiency:
- **Split cache by how often data changes.** Static data (market params, adapter lists, decimals, timelocks, roles) is cached for about an hour, or cleared after a governance change. Most refreshes are then only the totals rounds (1–2 `eth_call`s).
- **One snapshot per 60s TTL**, with concurrent requests sharing the in-flight read.
- An `eth_call` is billed per request, not per inner call, so batching every vault into one multicall is the cheap path.
- RPC key: server routes already read Base through `NEXT_PUBLIC_ALCHEMY_API_KEY` (e.g. the pending recheck in `vault-v2-pending.ts`). Consider a server-only `ALCHEMY_API_KEY` (curator's name for it) so the snapshot's load can use a separate, unexposed key.

### 5.2 Morpho REST only for what the chain cannot give

| Data | Endpoint | Cache |
| --- | --- | --- |
| Vault charts | `state/history`, `apy/history` | Daily / weekly lookbacks (`thirty_days` and up): about 1h. Hourly (`one_day`, `seven_days`): 5 min |
| Position chart | `position/history` | Per wallet, 60s (the existing `position-history-cache`) |
| Earned interest | `position/performance`, one call per held vault | Per wallet, 60s. The vault page and the dashboard / explorer Earned Interest column all need it (the positions list carries no profit), so cache per wallet + vault and share it between them |
| Wallet activity | `position/activity` | Only when the History tab opens |
| External / emptied vaults | `vaults-v2/users/{u}/positions?active_only=false` | Once per wallet (registry balances stay on chain) |
| Pending changes, roles | `pending-governance-actions`, `sentinels`, `allocators` | 5 min, plus the on-chain recheck of each pending item |

Use a server-only Morpho API key.

### 5.3 Rough call budget

| Page | On chain | REST |
| --- | --- | --- |
| Dashboard / explorer | 0–3 (shared snapshot) | 1 positions list + 1 history per held vault |
| Vault page | 0 (snapshot already warm) | 2 charts + 2 per wallet |

Vault-level data costs about one `eth_call` per 60s **per server instance**
(in-memory caches are not shared between Vercel instances). For comparison,
today's GraphQL reads already share Vercel's Data Cache (`next: { revalidate }`),
so the gain is mainly independence from Morpho, not fewer requests per view.

### 5.4 Order if adopted

1. Snapshot module + REST helper. Switch `complete`, `prices`, `caps` and `allocations` (the largest drop in Morpho calls).
2. History and wallet routes to REST.
3. Remove the GraphQL helper.

Open questions:
- Historical USD for cbBTC / WETH needs a price source (DefiLlama daily, or spot × tokens).
- Whether our own APY figure should be labelled differently from Morpho's (rewards excluded).
