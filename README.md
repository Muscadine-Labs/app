# Muscadine App

A Next.js app for Muscadine vaults on Base. Dashboard, vault explorer, and deposit/withdraw (v2 Prime/Frontier).

**Registry:** `src/lib/vaults.ts`.  
**Dev:** `npm run dev` → http://localhost:3000  
**Docs:** `CLAUDE.md` (architecture — Bundler3 WETH/ETH, force withdraw, asset pages), `AGENTS.md` (agent rules), `TODO.md` (task list).

**Product notes:** Base-only v2 vaults. External Morpho positions can appear in portfolio lists but only **whitelisted** registry vaults have detail/transact pages.

## Getting Started

Install dependencies:

```bash
npm install
```

Set up environment variables:

```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm start` - Start production server

## Security

**Reporting Security Vulnerabilities**

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email security concerns to: [muscadinelabs@gmail.com](mailto:muscadinelabs@gmail.com)
3. Include details about the vulnerability, steps to reproduce, and potential impact

We will acknowledge receipt within 48 hours and provide an assessment within 7 days.

**Security Best Practices**

- Never commit API keys or secrets to the repository
- Use environment variables for all sensitive configuration
- Keep dependencies up to date
- Review and audit smart contract interactions before executing transactions
- Verify transaction details before signing

## Environment Variables

Copy `.env.example` → `.env.local`.

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | **Yes** | Base RPC |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | **Yes** | RainbowKit / WalletConnect |
| `NEXT_PUBLIC_URL` | No | Canonical URL (default `https://app.muscadine.xyz`; set on Vercel in production) |

**Base App (in source, no env):** `base:app_id`, builder code `bc_mwkqu9rd`, Base Account via RainbowKit. Register app metadata on [base.dev](https://base.dev) at **`https://app.muscadine.xyz`**.

## Deployment checklist

1. **Vercel** — set `NEXT_PUBLIC_ALCHEMY_API_KEY`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, and `NEXT_PUBLIC_URL=https://app.muscadine.xyz`.
2. **base.dev** — register primary app URL as `https://app.muscadine.xyz` (app id in `src/lib/base-app.ts`).
3. **DNS** — point `app.muscadine.xyz` to Vercel.
4. **Verify** — navbar logo/favicon load (`/favicon.png`), connect wallet works, chart Y-axes show readable ticks (zoomed to data range, not 8-decimal tails).
