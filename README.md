# Clinic Finance

A finance workspace for a group of dental clinics, built with React, TypeScript, Vite and Supabase. GitHub holds the source, migrations, tests and documentation. GitHub Pages serves the static interface; Supabase is the trusted backend.

**Version 0.1 uses fictitious banking data. It does not connect to real bank accounts.** The default local experience runs immediately without a Supabase project. A separate local Supabase mode exercises authentication, organisation membership, tenant isolation and backend mock synchronisation.

## Run the demo

Install Node.js 24, then run from this repository:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The demo contains Clinic A, Clinic B and Personal, eight accounts and Australian-style transactions over 90 days ending 20 September 2026. Deposits, wages, rent, laboratory costs, dental supplies, subscriptions, loans, tax reserve movements and internal transfers are fictional.

The dashboard, account balances, searchable transactions, categorisation and basic analytics share deterministic calculations in integer AUD cents. Pending transactions and internal transfers are treated explicitly. This is a cash-movement view, not an accounting ledger or a GST calculation.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`npm run build` creates an explicit **demo** in `dist/`. `npm run build:production` requires the public configuration of a Supabase project and disallows mock mode. A build alone never establishes a live bank integration.

## Local Supabase and deployment

The selected backend setup is **local Supabase**. Docker and the Supabase CLI are needed only for that mode and database tests. See [local setup and GitHub Pages deployment](docs/deployment.md) for the exact commands, public environment variables, and the later hosted-backend route.

The intended repository is **private**. GitHub Pages from a private repository requires a supported paid GitHub plan, and a private repository does not itself make the website private. The demo is suitable for public viewing because it contains invented data. See the [GitHub Pages access requirements](docs/deployment.md#private-repository-and-site-visibility).

## What is implemented and what comes later

| Version 0.1 | Future modules |
| --- | --- |
| Dashboard, accounts, transactions and analytics | Live Basiq/Open Banking consent and synchronisation |
| Categorisation rules and manual category updates | Receipt ingestion, OCR and invoice matching |
| Internal-transfer matching foundations | Cash-flow forecasting, budgets and accounting |
| Supabase Auth, organisation membership and RLS | Payroll and practice-management integrations |
| Mock provider, protected backend sync and audit foundations | Scheduled jobs and economic time series |
| Static Pages builds and CI | AI explanations of approved deterministic queries |

Future endpoint placeholders return an explicit unavailable response; they do not perform OCR, economic-data imports or other unimplemented integrations. The [roadmap](docs/roadmap.md) describes the prerequisites for enabling them.

## Repository guide

```text
src/                   Static application, domain logic and data services
tests/                 Financial-domain and application checks
supabase/migrations/   Versioned database schema, constraints and RLS
supabase/functions/    Trusted sync and future integration entry points
supabase/tests/        Database security tests
docs/                  Architecture and operating instructions
.github/workflows/     Pull-request validation and Pages deployment
```

- [Architecture](docs/architecture.md): boundaries, data flow and design decisions.
- [Database](docs/database.md): tables, tenant keys and migrations.
- [Banking integration](docs/banking-integration.md): provider contract and mock sync.
- [Security](docs/security.md): authentication, RLS, secrets and access.
- [Deployment](docs/deployment.md): local setup, CI and GitHub Pages.
- [Roadmap](docs/roadmap.md): remaining work and release gates.

Never commit real statements, banking credentials, service-role keys or receipt contents. Only public project configuration belongs in `VITE_*` variables. Backend credentials stay in local ignored files or Supabase Edge Function secrets.
