# Database and API contract

Version 0.3 uses Supabase Auth, Postgres and Edge Functions. Apply migrations in filename order. Hosted migrations start with mock provisioning **disabled**. `supabase/seed.sql` enables mock mode only for the local development stack; do not apply that seed to production.

## Data model

| Table                                   | Purpose and access                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `organisations`, `organisation_members` | Tenant and owner/admin/viewer membership. Members see their organisation and their own membership row.                             |
| `entities`                              | Clinic, group-finance and optional personal entities within one tenant.                                                            |
| `bank_connections`, `accounts`          | Normalised provider connections and account snapshots.                                                                             |
| `transactions`                          | Integer AUD cents, positive inflows and negative outflows, date-only posting date, category provenance and optional transfer pair. |
| `categories`                            | Global, authenticated-readable category catalogue. Browser writes prohibited.                                                      |
| `audit_events`                          | Append-only from application RPCs; visible to tenant owners/admins.                                                                |
| `processing_jobs`                       | Tenant-readable processing status foundation. Mock sync writes successful jobs atomically.                                         |
| `receipts`                              | Future extraction/matching metadata; tenant scoped. Upload and extraction are not implemented.                                     |
| `economic_indicators`                   | Global authenticated-readable observations foundation; no live economic data in 0.1.                                               |
| `forecast_scenarios`                    | Tenant-scoped future assumptions foundation; no production forecasting service.                                                    |
| `private.provider_records`              | Raw provider evidence, unavailable to browsers and the public REST schema.                                                         |
| `private.runtime_config`                | Server-controlled deployment environment and mock enablement.                                                                      |
| `private.banking_profiles`              | Organisation-to-Basiq-user mapping, hidden from browser roles.                                                                     |
| `private.provider_connections`          | Private provider/local connection identity mapping used for cleanup.                                                               |

Every application table has RLS. Browser grants permit only SELECT; no broad financial INSERT/UPDATE/DELETE policies exist. Default privileges keep future tables, sequences and functions private until a migration explicitly grants them. Organisation-owned references include the organisation identifier in composite foreign keys. An account references both a same-tenant entity and same-tenant connection independently, allowing clinic assignment without rewriting provider connection ownership. Monetary values use bounded `bigint` integer cents.

Transaction uniqueness is `(organisation_id, account_id, provider_transaction_id)`. Tenant-scoped deterministic IDs prevent the same sample dataset colliding across organisations. Manual categories survive subsequent syncs. Raw evidence, normalised accounts/transactions, a completed job and its audit event commit together in the ingestion RPC. If the transaction fails, none of those changes commit. A failed-job scheduler and external alerting are future work; a failed sync returns an error and does not manufacture a completed job.

## Browser-callable RPCs

`create_demo_organisation(name text) → uuid` requires a signed-in user and a database configured for development/demo with mock data enabled. It atomically creates an organisation and owner membership. Concurrent/repeated requests return that user's first owned demo organisation. It does not create financial records. The browser then calls `bank-sync` for that organisation.

`set_transaction_category(transaction_id uuid, category_id uuid) → void` checks the transaction's organisation against current owner/admin membership, validates the category and records the previous/new category IDs in an audit event. Pass null to clear a category. Viewers and other tenants are rejected. Callers cannot change the amount, account, posting date or provider data through this RPC.

`create_live_organisation(name text) → uuid` is production-only and idempotently creates an owned non-demo workspace with Kilcoy, Burpengary and Group finance. `set_account_entity(account_id, entity_id) → void` lets an owner/admin assign an imported account to a same-tenant clinic/group entity and records an audit event.

`ingest_mock_dataset(organisation_id uuid, actor_user_id uuid, dataset jsonb) → jsonb` is executable only by `service_role`, never authenticated/anonymous users. It rechecks editor membership and demo eligibility inside the atomic write, and serialises syncs by locking the organisation. The Edge Function generates the dataset; request bodies cannot supply it.

`ingest_basiq_snapshot`, profile lookup/save/refresh claims and purge RPCs are executable only by `service_role` and run with invoker privileges. Live ingestion locks the private profile, rejects cross-tenant identifier collisions, preserves manual categorisation/account assignment and commits the snapshot plus job/audit result atomically.

## Edge Functions

All accept `POST` with JSON `{ "organisationId": "UUID" }`, an authenticated user JWT in `Authorization: Bearer …`, and the project's public API key. The handler validates the JWT through Supabase Auth `getUser()` and checks owner/admin membership before acting. OPTIONS handles CORS only. No data work occurs during preflight. Configuration uses `verify_jwt=false` because handlers explicitly validate user tokens, including current asymmetric signing-key tokens; this is not unauthenticated access.

| Endpoint                 | Version 0.3 behavior                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `bank-connect`           | Status plus hosted Basiq connect/manage/renew/revoke flows for a live owner/admin.              |
| `bank-sync`              | Mock sync for demo tenants or rate-limited provider refresh and atomic import for live tenants. |
| `bank-sync-scheduled`    | Secret-authenticated cached daily import across configured live profiles; not browser callable. |
| `transaction-processing` | Authenticated/authorised HTTP 501; no processing performed.                                     |
| `receipt-processing`     | Authenticated/authorised HTTP 501; no upload, extraction or matching performed.                 |
| `economic-data-sync`     | Authenticated/authorised HTTP 501; no external data fetched.                                    |

## Local operation and tests

From the repository root:

```sh
npm run db:start
npm run db:test
deno task --config supabase/functions/deno.json check
deno task --config supabase/functions/deno.json test
```

The database suite uses real PostgreSQL roles/JWT claims to check two-tenant isolation, viewer restrictions, raw-record denial, narrow RPC authorization, server-role ingestion, explicit current/default privileges, composite-key enforcement, amount limits, private storage and production demo rejection. Tests roll back their fixtures. A local Supabase Docker stack is required; cloud credentials are not needed.

For local functions, copy `supabase/functions/.env.example` to ignored `supabase/functions/.env.local`, then run `npx supabase functions serve --env-file supabase/functions/.env.local`. Supabase injects its server credentials. Use the local API URL and publishable/anon key in the frontend's ignored `.env.local`. Never place the service-role key in a Vite environment variable.

For a dedicated **nonproduction** hosted demo project, an administrator must deliberately enable its database gate:

```sql
update private.runtime_config
set environment = 'demo', allow_mock_data = true
where singleton = true;
```

The Edge Function must independently have `APP_ENV=demo` and `ALLOW_MOCK_DATA=true`. Production retains `environment='production'`, `allow_mock_data=false` and `APP_ENV=production`. Provision real organisations/memberships through a controlled admin process until production onboarding is implemented. Never repurpose the demo RPC for real customer onboarding.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [pgTAP testing](https://supabase.com/docs/guides/local-development/testing/pgtap-extended).
