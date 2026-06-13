# AGENTS.md — Muscadine App

Instructions for AI agents working in this repo. Full architecture docs live in `CLAUDE.md` — read it before non-trivial changes.

## Working agreement

1. **Review `TODO.md` at the start of every session.** It is the canonical task list:
   - “TO work on today” → actionable now.
   - “To work on another day” → backlog; do not start without being asked.
   - Update/remove entries as work completes.
2. **Before every push to GitHub:** run `npm run lint` and `npm run build`; both must pass.
3. **Version bump on every push:** bump `package.json` version by `0.0.1`. Digits roll over at 9 — e.g. `0.2.9` → `0.3.0`, `1.9.9` → `2.0.0`.
4. **Git commits only when the user explicitly asks.**
5. Keep `CLAUDE.md` and this file updated when conventions or architecture knowledge change.

## Key constraints

- **wagmi must stay on 2.x** (RainbowKit 2 requirement; wagmi 3 not adopted). **eslint stays on 9.x** (`eslint-config-next` breaks on 10). `@morpho-org/*-wagmi` 4.x+ ranges often require wagmi 3 — check before bumping.
- Base only today (chain id 8453). v2 Prime vaults are the default surface; v1 MetaMorpho is soft-deprecated (withdrawals still supported).
- v1 writes go through the bundler (`useVaultTransactions.ts`); v2 writes use direct ERC-4626 ABIs (`src/lib/transactionUtilsV2.ts`). Never mix the two paths.
- Resolve vault version via `getVaultVersion` / `findVaultByAddress` from `src/lib/vault-utils.ts`, never by asset symbol.
- Use `logger` from `src/lib/logger.ts`, not `console.log`.

## Known gotchas (hard-won knowledge)

- **Morpho v1 position history can stay stuck at the last held amount after a full withdrawal** while the live position is already 0. `finalizePositionHistory` in `src/lib/api-utils.ts` (used by both `position-history` routes) appends a zero point when the live position is closed, and strips Morpho's incomplete trailing zero buckets when the position is open. Without this, the dashboard portfolio chart forward-fills the stale value forever.
- Don't sum raw v1 + v2 position history for the same asset — `preparePortfolioVaultHistories` in `src/lib/portfolio-utils.ts` truncates v1 at the first v2 deposit to avoid double-counting.
- Morpho GraphQL invalid fields fail the whole request (HTTP 400) — validate queries against `https://api.morpho.org/graphql` when `complete` routes break. See the schema-changes table in `CLAUDE.md`.
- Turbopack chunk errors after mixing `build` and `dev`: `rm -rf .next .turbo && npm run dev`.

## Commands

```bash
npm run dev    # Turbopack dev server
npm run build  # Production build (run before pushes)
npm run lint   # ESLint (run before pushes)
```
