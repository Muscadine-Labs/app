# Morpho GraphQL → REST migration (app)

Morpho is shutting down `https://api.morpho.org/graphql` on **January 29, 2027**.
Every Morpho read in this app goes through it (`fetchMorphoGraphQL()` in
`src/lib/api-utils.ts`), so all of them have to move to the REST API before then.

Sources (reviewed 2026-11-19):

- Migration guide: https://docs.morpho.org/developers/api/migrate-from-graphql/
- REST reference: https://docs.morpho.org/api/
- OpenAPI spec (v1.0): https://docs.morpho.org/openapi.json

The paths and fields below come from that spec. They were also called live
against mpUSDC (`8453:0x8971…b496`) on 2026-11-19.

Status: **plan only. No code has changed yet.**

---

## 1. The new API at a glance

| Topic | REST |
| --- | --- |
| Base URL | `https://api.morpho.org` (public, no key). `https://private.api.morpho.org` takes an API key in the `x-api-key` header (request one at docs.morpho.org/request-api-key). |
| Versioning | Most routes are `/v0/...`. Only `/v1/vaults-v2/{v}/state` and `/v1/vaults-v2/{v}/apy-averages` are `/v1`. |
| Selectors | A vault or token is `8453:0xAddress`. A Blue market is `8453:0xMarketId`. |
| Envelope | The result is under `data`. Lists add a top-level `cursor` (`null` on the last page). Send it back unchanged and never build or parse one. |
| Limits | Public host: 750 req/min **per IP**. Going over returns 429 with `Retry-After: 600`. Above 3,334 req / 10 min the IP is blocked for 7 days. An API key raises the limits. |
| Unknown params | Silently ignored, so check every query param name against the spec. |
| Amounts | Integer strings in base units. Parse them with `BigInt`. |
| Fees / LLTV | `*_wad` strings (1e18 = 100%). `management_fee_wad` is **per second**: multiply by 31,536,000 for a yearly rate. `null` = no fee. |
| Share price | `share_price_ray` (divide by 1e27). |
| APY | Decimal fraction (0.0463 = 4.63%), nullable. Rewards are **not** included (Merkl has its own API). |
| Timestamps | Unix seconds. Most are integers, but token price `timestamp` and every `*_block_number` are **strings**. |
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
| `api/vault/v2/[address]/earned-interest` (`vaultV2PositionByAddress` → `pnl`) | `pnl` | `GET /v0/vaults-v2/{v}/users/{u}/position/performance` → `net_earnings_assets` (average-cost method) | Keep the activity fallback, built from `/position/activity`. Retired wrapper profit (`retiredWrapperEarnedPnl`) is the same call on the wrapper address. |
| `api/vault/v2/[address]/position-history` (`vaultV2PositionByAddress.history`) | `assets`, `assetsUsd`, `shares` | `GET /v0/vaults-v2/{v}/users/{u}/position/history?lookback=` → `{timestamp, shares, assets}` | No `assetsUsd`: multiply by the current price (good enough for USDC; cbBTC / WETH history becomes spot-priced). `finalizePositionHistory` stays. Map our periods to `lookback` (`seven_days`, `thirty_days`, `ninety_days`, `one_year`, `inception`). |
| `api/vault/v2/[address]/complete` (`vaultV2ByAddress`) | Name, asset, totals, liquidity, APY, owner/curator/sentinels, timelocks, maxRate, liquidityAdapter, fees, rewards, warnings | `GET /v0/vaults-v2/{v}`: `name`, `symbol`, `asset`, `owner`, `curator`, `governance.timelocks[]{function_name, timelock_seconds, is_abdicated}`, `max_rate_per_second_wad`, `liquidity_adapter`, `liquidity_data`, fees, `gates`.<br>`GET /v1/vaults-v2/{v}/state`: `total_assets`, `total_supply`, `withdrawable_assets` (= GraphQL `liquidity`), `idle_assets`, `share_price_ray`.<br>`GET /v1/vaults-v2/{v}/apy-averages?lookback=one_day` → `apy`.<br>`GET /v0/vaults-v2/{v}/sentinels`, `/allocators` → `role_address[]`.<br>Token price for `totalAssetsUsd` / `liquidityUsd`. | 5–6 calls instead of 1. Run them in parallel and cache the result as one unit. **There is no instant `netApy`.** Pick a lookback (`one_day` or `six_hours`) and say "24h avg" in the UI if needed. `rewards` → Merkl or drop it (no registry vault has rewards today). `warnings` is not shown to users, so drop it. `maxRate`: per-second WAD × 31,536,000. |
| `api/vault/v2/[address]/history` (`historicalState` TVL / APY / share price) | `totalAssets(Usd)`, `avgNetApy` | `GET /v0/vaults-v2/{v}/state/history?lookback=` → `total_assets`, `share_price_ray`, `withdrawable_assets`, `idle_assets`.<br>`GET /v0/vaults-v2/{v}/apy/history?lookback=` → `{timestamp, apy}` | `inception` is daily (mpUSDC: 374 state points / 342 APY points). Short lookbacks are hourly. Historical USD TVL needs a price source: spot × tokens, or DefiLlama. The `hasApy: false` gap handling stays (`apy` is nullable). Check `stripIncompleteVaultHistoryBuckets` still applies. |
| `src/lib/vault-v2-historical-ratio.ts` | `historicalState` | `state/history` (share price / totals) | |
| `src/lib/vault-v2-caps.ts` + `api/.../caps` | `adapters`, `caps` | `GET /v0/vaults-v2/{v}/allocations` → `allocations[]{adapter_address, adapter_kind, caps[]{cap_type, absolute_cap, relative_cap_wad, allocated_assets, market_id?}}` + `unscoped_caps[]` (collateral caps) | `absolute_cap` = 2^256−1 means "No limit" (we test uint128 max today, so handle both). Market names need `/v0/blue/markets/{m}` (no symbols, only token addresses → `/v0/tokens/{t}`). |
| `src/lib/vault-v2-allocations.ts` + `useVaultAllocations` + `api/.../allocations` | Positions per market with `supplyApy`, `liquidityUsd`, market size | `/allocations` (`allocated_assets` / `expected_supply_assets` per market cap), plus per market `GET /v0/blue/markets/{m}/state` (size = `total_supply_assets`), `/liquidity` (`market_liquidity`), `/apy-averages` (`supply_apy_averages['24h']`) | About 3 calls per market. Cache hard (60s) and only fetch the top rows plus "Other markets" on open, if needed. |
| `src/lib/vault-v2-pending.ts` + `api/.../pending` (`pendingConfigs`) | `functionName`, `data`, `validAt` | `GET /v0/vaults-v2/{v}/pending-governance-actions` → `action_type`, `parameters`, `executable_at_timestamp`, `submitted_transaction_hash` | `action_type` maps straight to the +/−/• marks (`add_adapter`, `increase_absolute_cap`, `set_performance_fee`, …). **There is no raw calldata**, so `dropResolvedOnChain` (`executableAt(data)`) has to re-encode calldata from `parameters` (they include the `selector`) or be dropped. Cap decreases are not timelocked and never appear. |
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
