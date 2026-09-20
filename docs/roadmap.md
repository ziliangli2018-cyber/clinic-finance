# Roadmap

Version 0.1 is a mock-first financial dashboard and a local Supabase foundation. Live financial accounts are deliberately outside this release. The order below keeps tenant security, provenance and deterministic calculations ahead of integrations.

| Milestone                  | Deliverable                                                                                                                                                                        | Completion gate                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 — current foundation   | Static React/TypeScript interface, eight mock accounts, transactions, categories, transfer matching, dashboard and analytics; Supabase schema/Auth/RLS, mock provider and Pages CI | Type, lint, domain, database and static-build checks pass; local Auth and demo ingestion verified; no live banking credentials                                   |
| 0.2 — backend operations   | Hosted development Supabase, member administration, audit review, durable sync jobs and operational monitoring                                                                     | Two-tenant end-to-end tests, retry/idempotency tests, backup/restore exercise, explicit environment separation                                                   |
| 0.3 — banking pilot        | Basiq provider behind the common interface, consent lifecycle, server-side refresh and incremental synchronisation                                                                 | Provider approval and sandbox testing, validated consent/revocation, duplicate/update handling, retention decisions and reconciliation against source statements |
| 0.4 — receipt workflow     | Private uploads, OCR/extraction, normalised documents, transaction-match suggestions and human review                                                                              | Storage isolation, file validation, extraction provenance, access logs and reprocessing tests                                                                    |
| 0.5 — management reporting | Budgets, cash-flow scenarios, loan tracking, reviewed GST inputs and accounting exports                                                                                            | Documented calculation definitions, reviewed tax treatment and reconciliation tests                                                                              |
| 0.6 — wider clinic data    | Practice-management, payroll, marketing and inventory adapters                                                                                                                     | Provider agreements, minimal required data, stable tenant mapping and versioned normalisation                                                                    |
| 0.7 — external context     | RBA/ABS economic series, inflation adjustment and business comparisons                                                                                                             | Units, revisions, release dates, coverage gaps and index methodology visible in every result                                                                     |
| 0.8 — AI explanations      | Natural-language questions over approved analytics functions                                                                                                                       | Tenant-scoped tools, source-linked outputs, deterministic numbers, logging and evaluation of misleading answers                                                  |

## Before live banking

1. Establish a separate production Supabase project, authentication delivery, redirect allowlist, backups and access ownership.
2. Keep `APP_ENV=production` and `ALLOW_MOCK_DATA=false` on the backend, and keep production database demo provisioning disabled.
3. Complete the Basiq adapter with server-side credentials, explicit consent and revocation, provider retry/backoff and rate-limit handling.
4. Verify synchronisation under duplicate events, out-of-order updates, partial failures and concurrent refresh requests.
5. Exercise tenant boundaries using separate users and organisations across database reads, RPCs, functions, jobs and Storage.
6. Reconcile balances and transactions against a permitted test source before a limited, authorised live pilot.
7. Enable production Pages mode only after its own public Supabase configuration is set. A public interface must reveal no organisation data until authentication and RLS allow it.

## Scheduled work

There is no enabled recurring financial synchronisation in Version 0.1. The first scheduler should invoke trusted jobs for a specific tenant and connection, independently of browser sessions. Add durable job status, a run lock, bounded retries, idempotency keys and alerts before scheduling regular refreshes. Receipt extraction, economic-data refreshes and reports can then reuse the same job model.

## Calculation quality

Extend the existing cent-based calculations with fixtures for reversals, refunds, pending-to-posted transitions, credit cards, split categories, partial transfers and overlapping date windows. Add an accounting model before naming a cash-flow measure “profit”. Treat GST and tax reserve calculations as separately reviewed rules with explicit inputs and limitations.

## Issue tracking

Track each deliverable as a GitHub issue with its affected data model, access rules, expected user behaviour and acceptance checks. Link migrations and implementation pull requests to that issue. Review the relevant architecture document when adding a new provider, tenant-owned table, job type or source of credentials.
