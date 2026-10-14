# Clinic Finance

A finance workspace for a group of dental clinics, built with React, TypeScript, Vite and Supabase. GitHub holds the source, migrations, tests and documentation. GitHub Pages serves the static interface; Supabase is the trusted backend for deliberately enabled authenticated banking workspaces.

**The public interface offers a fictional bank demo and a separate device-only CSV workspace. It does not yet connect to real bank accounts.** Version 0.5 adds bank-statement CSV imports with column mapping, validation, automatic category suggestions, duplicate detection, calculated summaries, visualisations, forecasts and imported-data JSON backups. Kilcoy, Burpengary and the confirmed legal loan borrower remain separate. Imports are never mixed with fictional data or bank-feed records.

CSV contents are processed and stored in this browser profile, not uploaded or cloud-synced by the importer. They are **not encrypted by the app** and are accessible to anyone using that browser profile. Statement balances are manually supplied dated snapshots, not real-time balances. Avoid patient identifiers and keep a secure backup. See the [CSV import guide](docs/csv-import-guide.md) for the workflow, supported formats and limits.

Frollo-inspired budgets, goals, recurring bills, spending insights, a portfolio overview, bulk category edits and filtered CSV exports remain available. The Basiq Open Banking backend is production-gated until provider enablement, server secrets and bank consent are complete.

The [Frollo feature map and REA investigation](docs/frollo-feature-map.md) record the public evidence, implemented workflows and remaining differences.

Open the website: **[ziliangli2018-cyber.github.io/clinic-finance](https://ziliangli2018-cyber.github.io/clinic-finance/)**.

## Run the demo

Install Node.js 24, then run from this repository:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The demo contains Kilcoy, Burpengary, Group finance and Personal, with nine accounts including two fictional NAB clinic portfolios and a fictional BOQ Specialist practice loan. It contains Australian-style transactions over 90 days ending 20 September 2026. Deposits, wages, rent, laboratory costs, dental supplies, subscriptions, loans, tax reserve movements and internal transfers are fictional.

The dashboard, account balances, searchable transactions, categorisation, 30/60/90-day forecasting and analytics share deterministic calculations in integer AUD cents. Pending transactions and internal transfers are treated explicitly. The live activity is a clearly labelled browser simulation. Manual categories and simulated updates stay in local browser storage until Reset demo is selected. This is a planning-oriented cash-movement view, not an accounting ledger, financial advice or a GST calculation.

To work with your own statements, select **Import CSV**, review and import an AUD bank export, then use the **My CSV data** workspace. Each file requires its account owner, closing balance and balance date. Imported CSV data never runs the demo simulation or contacts Basiq. Use **All imported history** if an older statement falls outside the selected reporting period.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`npm run build` creates the public interface with its fictional demo and separate browser-local CSV workflow in `dist/`; this is the default GitHub Pages target. `npm run build:hosted-demo` requires hosted Supabase configuration and email/password sign-in while the backend serves fictitious records. `npm run build:production` uses Supabase, disallows mock ingestion and exposes the consent-management interface. A build alone never establishes a live bank integration; follow the [production banking runbook](docs/basiq-production-onboarding.md).

## Local Supabase and deployment

Local Supabase is available for development and for testing the authenticated architecture. The default public deployment does not use it. A deliberately selected hosted mode uses a separate Supabase project for authentication, private database access and trusted mock ingestion. See [setup and deployment](docs/deployment.md) for the exact commands and environment variables.

The repository is [**public**](https://github.com/ziliangli2018-cyber/clinic-finance), as requested for GitHub Pages hosting. Source code, history and fictitious test fixtures are public. The default Pages build contains the mock dataset and browser-local interactions, not your imported statement contents; it has no banking or Supabase credentials. CSV data remains in the browser profile and is not protected by cloud sign-in or row-level security. If the deployment is deliberately switched to `hosted-demo` or `production`, cloud application records remain in Supabase behind sign-in, organisation membership and row-level security. Public self-registration is hidden in hosted builds and must also be disabled in the hosted Supabase Auth settings. Local development still supports signup for testing.

## What is implemented and what comes later

| Implemented in version 0.5                                                    | Later modules                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Separate device-local CSV imports, previews and dated account balances        | Encrypted, authenticated statement storage        |
| Rule-based categories, duplicate checks and imported-data JSON backup/restore | Reviewed custom category rules and split payments |
| Separate Kilcoy/Burpengary ownership and confirmed CSV loan borrower          | Receipt ingestion, OCR and invoice matching       |
| Multi-institution Basiq consent, refresh, expiry and disconnection boundaries | Editable forecast scenarios                       |
| Monthly budgets, savings goals, recurring bills and spending insights         | Transaction notes, tags and future rules          |
| Bulk category edits, matching-merchant edits and amount filters               | Account history and off-bank asset tracking       |
| NAB and BOQ Specialist account classes, including loans                       | Accounting and practice-management integrations   |
| Tenant/entity-isolated ingestion preserving manual categories                 | Payroll and practice-management integrations      |
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
- [CSV import guide](docs/csv-import-guide.md): statement upload, categorisation, balances, privacy and backups.
- [Security](docs/security.md): authentication, RLS, secrets and access.
- [Deployment](docs/deployment.md): local setup, CI and GitHub Pages.
- [Roadmap](docs/roadmap.md): remaining work and release gates.

Never commit real statements, banking credentials, service-role keys or receipt contents. Only public project configuration belongs in `VITE_*` variables. Backend credentials stay in local ignored files or Supabase Edge Function secrets.
