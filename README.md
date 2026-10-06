# Clinic Finance

A finance workspace for a group of dental clinics, built with React, TypeScript, Vite and Supabase. GitHub holds the source, migrations, tests and documentation. GitHub Pages serves the static interface; Supabase is the trusted backend.

**The public website uses fictitious banking data. It does not connect to real bank accounts.** The browser demo runs immediately without a Supabase project, simulates new activity, saves local changes on the device, forecasts cash flow and exports filtered transactions as CSV. Version 0.3 also contains a production-gated Basiq Open Banking backend for an authenticated Supabase deployment; it is disabled until commercial onboarding, server secrets and a live-account pilot are complete.

Open the hosted demo: **[ziliangli2018-cyber.github.io/clinic-finance](https://ziliangli2018-cyber.github.io/clinic-finance/)**.

## Run the demo

Install Node.js 24, then run from this repository:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The demo contains Kilcoy, Burpengary, Group finance and Personal, with nine accounts including two fictional NAB clinic portfolios and a fictional BOQ Specialist practice loan. It contains Australian-style transactions over 90 days ending 20 September 2026. Deposits, wages, rent, laboratory costs, dental supplies, subscriptions, loans, tax reserve movements and internal transfers are fictional.

The dashboard, account balances, searchable transactions, categorisation, 30/60/90-day forecasting and analytics share deterministic calculations in integer AUD cents. Pending transactions and internal transfers are treated explicitly. The live activity is a clearly labelled browser simulation. Manual categories and simulated updates stay in local browser storage until Reset demo is selected. This is a planning-oriented cash-movement view, not an accounting ledger, financial advice or a GST calculation.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`npm run build` creates the safe public browser demo in `dist/`; this is the default GitHub Pages target. `npm run build:hosted-demo` requires hosted Supabase configuration and email/password sign-in while the backend serves fictitious records. `npm run build:production` uses Supabase, disallows mock ingestion and exposes the consent-management interface. A build alone never establishes a live bank integration; follow the [production banking runbook](docs/basiq-production-onboarding.md).

## Local Supabase and deployment

Local Supabase is available for development and for testing the authenticated architecture. The default public deployment does not use it. A deliberately selected hosted mode uses a separate Supabase project for authentication, private database access and trusted mock ingestion. See [setup and deployment](docs/deployment.md) for the exact commands and environment variables.

The repository is [**public**](https://github.com/ziliangli2018-cyber/clinic-finance), as requested for GitHub Pages hosting. Source code, history and fictitious test fixtures are public. The default Pages deployment contains only the mock dataset and browser-local interactions; it has no banking or Supabase credentials. If the deployment is deliberately switched to `hosted-demo` or `production`, application records remain in Supabase behind sign-in, organisation membership and row-level security. Public self-registration is hidden in hosted builds and must also be disabled in the hosted Supabase Auth settings. Local development still supports signup for testing.

## What is implemented and what comes later

| Implemented in version 0.3                                                    | Later modules                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Kilcoy, Burpengary and Group finance account mapping                          | Receipt ingestion, OCR and invoice matching       |
| Multi-institution Basiq consent, refresh, expiry and disconnection boundaries | User-managed budgets and forecast scenarios       |
| NAB and BOQ Specialist account classes, including loans                       | Accounting and practice-management integrations   |
| Tenant-isolated atomic ingestion preserving manual categories and assignments | Payroll and practice-management integrations      |
| Daily scheduler endpoint plus rate-limited manual refresh                     | Provider webhook acceleration and alerting        |
| 30/60/90-day forecast and formula-safe filtered CSV exports                   | Reviewed management and tax reporting             |
| Public-demo, hosted-demo and production GitHub Pages builds                   | AI explanations of approved deterministic queries |

The production path remains fail-closed until Basiq approves the application and its CDR access model, a production Supabase project is configured, and the exact three accounts pass a live pilot. Open Banking is an automatically refreshed feed rather than a streaming balance service, so the interface always shows the last successful sync. The [roadmap](docs/roadmap.md) describes the remaining release gates.

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
- [Banking integration](docs/banking-integration.md): consent, synchronisation and deletion boundaries.
- [Production banking runbook](docs/basiq-production-onboarding.md): provider, bank and deployment checklist.
- [Security](docs/security.md): authentication, RLS, secrets and access.
- [Deployment](docs/deployment.md): local setup, CI and GitHub Pages.
- [Roadmap](docs/roadmap.md): remaining work and release gates.

Never commit real statements, banking credentials, service-role keys or receipt contents. Only public project configuration belongs in `VITE_*` variables. Backend credentials stay in local ignored files or Supabase Edge Function secrets.
