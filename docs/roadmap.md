# Roadmap

Version 0.3 retains the safe public demo and adds a production-gated Basiq banking implementation for NAB and BOQ Specialist. Real accounts remain disabled until provider approval, production configuration and the live pilot gates are complete. The order below keeps tenant security, provenance and deterministic calculations ahead of broader integrations.

| Milestone                  | Deliverable                                                                                                                                                                  | Completion gate                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 — foundation           | Static React/TypeScript interface, mock accounts, transactions, categories, transfer matching, dashboard and analytics; Supabase schema/Auth/RLS, mock provider and Pages CI | Type, lint, domain, database and static-build checks pass; local Auth and demo ingestion verified; no live banking credentials                    |
| 0.2 — public demo          | Simulated live activity, device-local persistence/reset, manual categorisation, 30/60/90-day indicative forecast, filtered CSV export and public Pages release               | Deterministic simulation/forecast tests, responsive browser checks, public-demo build and Pages deployment pass                                   |
| 0.3 — connected-bank code  | Kilcoy/Burpengary/group mapping; Basiq consent, multi-institution import, loans, manual/scheduled refresh, expiry cleanup and account assignment                             | Frontend, Edge and database tests pass; provider secrets remain absent from GitHub; production gates fail closed                                  |
| 0.4 — authorised pilot     | Activate the approved Basiq application against the exact two NAB portfolios and BOQ Specialist loan                                                                         | Commercial/CDR approval, consent/revocation and renewal tests, operational alerts, privacy processes and reconciliation against source statements |
| 0.5 — receipt workflow     | Private uploads, OCR/extraction, normalised documents, transaction-match suggestions and human review                                                                        | Storage isolation, file validation, extraction provenance, access logs and reprocessing tests                                                     |
| 0.6 — management reporting | Budgets, cash-flow scenarios, loan tracking, reviewed GST inputs and accounting exports                                                                                      | Documented calculation definitions, reviewed tax treatment and reconciliation tests                                                               |
| 0.7 — wider clinic data    | Practice-management, payroll, marketing and inventory adapters                                                                                                               | Provider agreements, minimal required data, stable tenant mapping and versioned normalisation                                                     |
| 0.8 — external context     | RBA/ABS economic series, inflation adjustment and business comparisons                                                                                                       | Units, revisions, release dates, coverage gaps and index methodology visible in every result                                                      |
| 0.9 — AI explanations      | Natural-language questions over approved analytics functions                                                                                                                 | Tenant-scoped tools, source-linked outputs, deterministic numbers, logging and evaluation of misleading answers                                   |

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

## Calculation quality

Extend the existing cent-based calculations with fixtures for reversals, refunds, pending-to-posted transitions, credit cards, split categories, partial transfers and overlapping date windows. Add an accounting model before naming a cash-flow measure “profit”. Treat GST and tax reserve calculations as separately reviewed rules with explicit inputs and limitations.

## Issue tracking

Track each deliverable as a GitHub issue with its affected data model, access rules, expected user behaviour and acceptance checks. Link migrations and implementation pull requests to that issue. Review the relevant architecture document when adding a new provider, tenant-owned table, job type or source of credentials.
