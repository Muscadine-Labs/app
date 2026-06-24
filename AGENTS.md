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
- **v2 writes:** direct ERC-4626 ABIs in `src/lib/transactionUtilsV2.ts` (no Morpho bundler SDK in repo).
- Registry: `src/lib/vaults.ts` — fields include `strategy` (`prime` | `frontier`), `vaultSymbol` (e.g. `mpUSDC`, `mfUSDC`).
- Use `findVaultByAddress` / `isCuratedVaultAddress` from `src/lib/vault-utils.ts` — never infer vault by asset symbol alone.
- Use `logger` from `src/lib/logger.ts`, not `console.log`.

## Dev mode vs standard

| Mode | Storage (`preference`) | Effect |
|------|------------------------|--------|
| **Standard** | `v2` | Normal product surface. Explorer filters default to **All** (network, strategy, asset). |
| **Developer** | `all` (UI: Dev) | Same explorer defaults as standard; **transact over-balance bypass** only. No v1/v2 toggles (v1 removed). |

## Dashboard & positions

- **Your Vaults** (dashboard): **v2** positions only (registry + external Morpho v2 vaults).
- **Morpho Vaults total** includes **all** user v2 positions from Morpho (`/api/user/morpho-positions`), not only Muscadine registry vaults.
- **External vaults** (not in `vaults.ts`): shown on dashboard totals, **not clickable** (no detail/transact pages).
- **Portfolio chart:** all Morpho **v1 + v2** positions via `/api/user/morpho-positions` + per-vault `position-history` (v1 `position-history` API kept for Muscadine migration backfill only).
- **Earned interest:** `/api/vault/v2/.../earned-interest` + `useVaultEarnedInterest`; shows **0** (not `-`) when user never deposited. Use `resolveAssetDecimals` / `getAssetDecimalsForSymbol`.

## Known gotchas

- Portfolio v1→v2 cutover: `preparePortfolioVaultHistories()` + `legacy-vaults.ts` — only for known Muscadine v1 addresses, not symbol-only pairing.
- Morpho GraphQL invalid fields fail the whole request (HTTP 400).
- Morpho public API rate limit (429): all server Morpho calls use `fetchMorphoGraphQL()` in `api-utils.ts` (in-memory cache, retries, stale fallback). Routes return 503 with `MORPHO_RATE_LIMIT_BODY` when limited.
- Overlay scroll lock: use `useLockPageScroll()` — locks `body` and `[data-app-scroll]` in `AppLayout`.
- Turbopack chunk errors: `rm -rf .next .turbo && npm run dev`.

## Commands

```bash
npm run dev      # Turbopack dev server
npm run build    # Production build (run before pushes)
npm run lint     # ESLint (run before pushes)
```
