# Roadmap

Version 0.5 adds a separate device-only bank-statement CSV workspace to the Frollo-inspired budgets, goals, recurring bills, insights and bulk transaction tools. It provides a usable statement-based fallback while Basiq access remains production-gated. The public interface supports both a fictional demo and private browser-local imported data; imports are not uploaded or app-encrypted, and dated statement balances are not real-time bank balances. See the [CSV import guide](csv-import-guide.md).

| Milestone                  | Deliverable                                                                                                                                                                  | Completion gate                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 — foundation           | Static React/TypeScript interface, mock accounts, transactions, categories, transfer matching, dashboard and analytics; Supabase schema/Auth/RLS, mock provider and Pages CI | Type, lint, domain, database and static-build checks pass; local Auth and demo ingestion verified; no live banking credentials     |
| 0.2 — public demo          | Simulated live activity, device-local persistence/reset, manual categorisation, 30/60/90-day indicative forecast, filtered CSV export and public Pages release               | Deterministic simulation/forecast tests, responsive browser checks, public-demo build and Pages deployment pass                    |
| 0.3 — connected-bank code  | Separate Kilcoy/Burpengary legal profiles; borrower-selected BOQS consent, multi-institution import, loans, manual/scheduled refresh and expiry cleanup                      | Frontend, Edge and database tests pass; provider secrets remain absent from GitHub; production gates fail closed                   |
| 0.4 — money management     | Portfolio overview, monthly budgets, savings goals, detected/editable bills, insights, amount filters and bulk category edits                                                | CRUD/reload, entity scoping, calendar recurrence, tenant RLS and browser checks pass                                               |
| 0.5 — statement workspace  | Device-local CSV imports, mapping/review, separate legal owners, explicit dated balances, rule categorisation, duplicate checks, analytics and dataset-only JSON backups     | Parser/cent arithmetic, all-or-nothing validation, no sample mixing, persistence/restore, entity ownership and browser checks pass |
| Live activation            | Activate the enabled Basiq application against the two NAB portfolios and BOQ Specialist loan                                                                                | Provider enablement, credentials, bank consent and source-statement reconciliation                                                 |
| Receipt workflow — future  | Private uploads, OCR/extraction, normalised documents, transaction-match suggestions and human review                                                                        | Storage isolation, file validation, extraction provenance, access logs and reprocessing tests                                      |
| 0.6 — management reporting | Editable cash-flow scenarios, loan tracking, reviewed GST inputs and accounting exports                                                                                      | Documented calculation definitions, reviewed tax treatment and reconciliation tests                                                |
| 0.7 — wider clinic data    | Practice-management, payroll, marketing and inventory adapters                                                                                                               | Provider agreements, minimal required data, stable tenant mapping and versioned normalisation                                      |
| 0.8 — external context     | RBA/ABS economic series, inflation adjustment and business comparisons                                                                                                       | Units, revisions, release dates, coverage gaps and index methodology visible in every result                                       |
| 0.9 — AI explanations      | Natural-language questions over approved analytics functions                                                                                                                 | Tenant-scoped tools, source-linked outputs, deterministic numbers, logging and evaluation of misleading answers                    |

## Before live banking

1. Establish a separate production Supabase project, authentication delivery, redirect allowlist, backups and access ownership.
2. Keep `APP_ENV=production` and `ALLOW_MOCK_DATA=false` on the backend, and keep production database demo provisioning disabled.
3. Complete Basiq production onboarding, approve the consent model and exercise the implemented adapter's retry, revocation and rate-limit behaviour against the permitted production application.
4. Verify synchronisation under duplicate events, out-of-order updates, partial failures and concurrent refresh requests.
5. Exercise tenant boundaries using separate users and organisations across database reads, RPCs, functions, jobs and Storage.
6. Reconcile balances and transactions against a permitted test source before a limited, authorised live pilot.
7. Enable production Pages mode only after its own public Supabase configuration is set. A public interface must reveal no organisation data until authentication and RLS allow it.

## Scheduled work

The browser demo timer changes only fictional in-memory data while the page is open. Production includes a server-authenticated daily scheduler endpoint and durable audit/job records, but scheduling is an operator deployment step. Before activation, configure Supabase/Vault-backed scheduling, failure alerts and a runbook; never invoke financial sync from the public browser or GitHub Pages. Receipt extraction, economic-data refreshes and reports can reuse the same backend job boundary later.

CSV imports do not simulate activity, run scheduled bank sync or contact Basiq. Upload another statement to update transactions and provide the bank's closing balance for that statement date. A combined CSV cash forecast is available only when the selected cash accounts have aligned balance dates; otherwise choose a clinic with aligned account snapshots or update the statements. Loan balances remain liabilities rather than available cash.

## Calculation quality

Extend the existing cent-based calculations with fixtures for reversals, refunds, pending-to-posted transitions, credit cards, split categories, partial transfers and overlapping date windows. Add an accounting model before naming a cash-flow measure “profit”. Treat GST and tax reserve calculations as separately reviewed rules with explicit inputs and limitations.

## Issue tracking

Track each deliverable as a GitHub issue with its affected data model, access rules, expected user behaviour and acceptance checks. Link migrations and implementation pull requests to that issue. Review the relevant architecture document when adding a new provider, tenant-owned table, job type or source of credentials.
