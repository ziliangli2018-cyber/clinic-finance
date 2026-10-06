# Clinic Finance

A finance workspace for a group of dental clinics, built with React, TypeScript, Vite and Supabase. GitHub holds the source, migrations, tests and documentation. GitHub Pages serves the static interface; Supabase is the trusted backend.

**The public website uses fictitious banking data. It does not connect to real bank accounts.** The browser demo runs immediately without a Supabase project, simulates new activity, saves local changes on the device, forecasts cash flow and exports filtered transactions as CSV. A separate Supabase mode exercises authentication, organisation membership, tenant isolation and backend mock synchronisation.

Open the hosted demo: **[ziliangli2018-cyber.github.io/clinic-finance](https://ziliangli2018-cyber.github.io/clinic-finance/)**.

## Run the demo

Install Node.js 24, then run from this repository:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The demo contains Clinic A, Clinic B and Personal, eight accounts and Australian-style transactions over 90 days ending 20 September 2026. Deposits, wages, rent, laboratory costs, dental supplies, subscriptions, loans, tax reserve movements and internal transfers are fictional.

The dashboard, account balances, searchable transactions, categorisation, 30/60/90-day forecasting and analytics share deterministic calculations in integer AUD cents. Pending transactions and internal transfers are treated explicitly. The live activity is a clearly labelled browser simulation. Manual categories and simulated updates stay in local browser storage until Reset demo is selected. This is a planning-oriented cash-movement view, not an accounting ledger, financial advice or a GST calculation.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`npm run build` creates the safe public browser demo in `dist/`; this is the default GitHub Pages target. `npm run build:hosted-demo` requires hosted Supabase configuration and email/password sign-in while the backend serves fictitious records. `npm run build:production` also requires Supabase and disallows mock ingestion. A build alone never establishes a live bank integration.

## Local Supabase and deployment

Local Supabase is available for development and for testing the authenticated architecture. The default public deployment does not use it. A deliberately selected hosted mode uses a separate Supabase project for authentication, private database access and trusted mock ingestion. See [setup and deployment](docs/deployment.md) for the exact commands and environment variables.

The repository is [**public**](https://github.com/ziliangli2018-cyber/clinic-finance), as requested for GitHub Pages hosting. Source code, history and fictitious test fixtures are public. The default Pages deployment contains only the mock dataset and browser-local interactions; it has no banking or Supabase credentials. If the deployment is deliberately switched to `hosted-demo` or `production`, application records remain in Supabase behind sign-in, organisation membership and row-level security. Public self-registration is hidden in hosted builds and must also be disabled in the hosted Supabase Auth settings. Local development still supports signup for testing.

## What is implemented and what comes later

| Public demo                                                  | Future production modules                         |
| ------------------------------------------------------------ | ------------------------------------------------- |
| Dashboard, accounts, transactions and analytics              | Live Open Banking consent and synchronisation     |
| Persistent manual categorisation and simulated live activity | Receipt ingestion, OCR and invoice matching       |
| 30/60/90-day cash-flow forecast with indicative range        | User-managed budgets and forecast scenarios       |
| Filtered, formula-safe CSV exports                           | Accounting and practice-management integrations   |
| Internal-transfer matching foundations                       | Payroll and practice-management integrations      |
| Optional Supabase Auth, organisation membership and RLS      | Production banking provider operations            |
| Mock provider, protected backend sync and audit foundations  | Scheduled jobs and economic time series           |
| Static Pages builds and CI                                   | AI explanations of approved deterministic queries |

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
