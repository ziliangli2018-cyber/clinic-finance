# Banking integration boundary

Version 0.3 implements a production-gated Basiq v3 Open Banking path alongside the deterministic public demo. The browser never receives a Basiq API key, provider-user identifier, service-role key or bank credential. All consent tokens are short-lived, user-bound links to `https://consent.basiq.io/home` and are neither logged nor stored by the browser.

The default GitHub Pages release is still `demo/mock`. It contains only fictional records. A production build is a separately selected deployment using Supabase Auth, row-level security and Edge Functions.

## Supported operating model

- Kilcoy and Burpengary are provisioned as clinic entities.
- Group finance is the safe default for newly imported accounts, including the BOQ Specialist loan.
- An owner/admin assigns every imported account to Kilcoy, Burpengary or Group finance. Provider refreshes preserve that assignment.
- Allowed institutions are server-configured. The initial production list is NAB (`AU01001`) and BOQ Specialist (`AU20130`); more institution IDs can be added after coverage and pilot testing.
- Supported account classes are transaction, operating, savings, credit card, loan, mortgage and term deposit. Loans and mortgages are liabilities and are excluded from available cash and opening cash forecasts.
- `connect` adds an institution or newly available account, `manage` reviews/revokes sharing, and `extend`/`reauthorise` handle consent renewal.

If the clinics are separate legal entities/ABNs, use separately approved business profiles/consents rather than treating them as locations of one legal entity. The current interface provisions one business profile per workspace; create separate production workspaces or extend the profile selector before onboarding two legal entities.

## Request and data flow

1. The signed-in owner creates a live workspace. The database creates Kilcoy, Burpengary and Group finance without demo records.
2. `bank-connect` validates the Auth session and owner/admin membership, creates a Basiq Business Consumer user server-side, and returns a short-lived consent URL.
3. The user selects accounts on Basiq/bank-hosted consent screens. The app never asks for an internet-banking password.
4. `bank-sync` enforces a 90-minute explicit provider-refresh interval, starts the asynchronous job when eligible, otherwise reads the latest provider cache, validates the full provider scope, normalises integer AUD cents, and calls one trusted ingestion transaction.
5. The ingestion RPC upserts connections, accounts and transactions atomically. Provider facts update, while manual categories and clinic assignments remain unchanged.
6. `bank-sync-scheduled` performs cached daily imports without consuming repeated explicit refreshes. It is callable only with a separate high-entropy scheduler secret.
7. Consent expiry/revocation purges imported connections, accounts and transactions. Full disconnection also deletes the private provider profile after provider revocation.

Only account names, institution names, masked numbers, balances, transaction facts and consent/sync status reach public tenant tables. Unmasked account numbers, BSBs, bank credentials and provider tokens are not persisted. Provider identifiers are kept in RLS-protected private tables accessible only through service-role RPCs.

## Fail-closed gates

Live provider code is enabled only when all of the following are true:

1. `APP_ENV=production`.
2. `ALLOW_MOCK_DATA=false`.
3. `BASIQ_ENABLED=true`.
4. `BASIQ_BUSINESS_ONBOARDING_APPROVED=true`.
5. A server-only API key, validated business profile and allowed-institution list exist.
6. The organisation is non-demo and the requesting user is an owner/admin.

Mock ingestion uses the inverse environment gates and only demo organisations. A production organisation can never silently fall back to fictional data.

## Refresh semantics

The product deliberately says “last successful sync,” not “real-time.” Basiq refreshes are asynchronous, Open Banking explicit refreshes are limited, and some institutions may have latency. The application triggers at most one explicit provider refresh every 90 minutes per workspace (at most 16 per day), reads the latest provider cache between those refreshes, and uses scheduled cached imports for ordinary updates. A provider failure does not commit a partial snapshot.

## Remaining activation gates

Code completion is not provider authorisation. Before handling real account data, complete Basiq commercial/security onboarding and the approved CDR access model, verify the legal-entity structure, configure consent copy/scopes/retention, enable operational monitoring, and run the live pilot in [the production runbook](basiq-production-onboarding.md). Do not place a Basiq key, business profile, scheduler secret or service-role key in GitHub, a `VITE_*` variable or chat.
