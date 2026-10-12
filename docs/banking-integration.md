# Banking integration boundary

Version 0.3 implements a production-gated Basiq v3 Open Banking path alongside the deterministic public demo. The browser never receives a Basiq API key, provider-user identifier, service-role key or bank credential. All consent tokens are short-lived, user-bound links to `https://consent.basiq.io/home` and are neither logged nor stored by the browser.

The default GitHub Pages release is still `demo/mock`. It contains only fictional records. A production build is a separately selected deployment using Supabase Auth, row-level security and Edge Functions.

## Supported operating model

- Kilcoy and Burpengary are provisioned as clinic entities.
- Each business entity has an independent private Basiq user and bank-consent profile.
- Every imported connection and account inherits the legal entity that initiated consent. Database constraints prevent cross-entity reassignment.
- The BOQ Specialist loan is connected from its confirmed legal borrower's profile. Group finance is available only when that entity is the borrower.
- Allowed institutions are server-configured. The initial production list is NAB (`AU01001`) and BOQ Specialist (`AU20130`); more institution IDs can be added after coverage and pilot testing.
- Supported account classes are transaction, operating, savings, credit card, loan, mortgage and term deposit. Loans and mortgages are liabilities and are excluded from available cash and opening cash forecasts.
- `connect` adds an institution or newly available account, `manage` reviews/revokes sharing, and `extend`/`reauthorise` handle consent renewal.

Adding another account for an existing entity uses that entity's **Add bank or account** consent action and requires no schema or code change. A genuinely new legal entity needs a new entity record plus an approved server-side business profile before consent is enabled.

## Request and data flow

1. The signed-in owner creates a live workspace. The database creates Kilcoy, Burpengary and Group finance without demo records.
2. The user chooses Kilcoy, Burpengary or the confirmed loan borrower. `bank-connect` validates Auth, owner/admin membership and entity ownership, creates that entity's Basiq Business Consumer user server-side, and returns a short-lived consent URL.
3. The user selects accounts on Basiq/bank-hosted consent screens. The app never asks for an internet-banking password.
4. When consent returns to the banking screen and its connection becomes active, the browser automatically starts the first import. A short-lived return marker contains only workspace/entity IDs and a timestamp; it never stores the consent URL or token. Status/import retries are bounded and leave a manual refresh available if the bank takes longer.
5. `bank-sync` enforces a 90-minute explicit provider-refresh interval, starts the asynchronous job when eligible, otherwise reads the latest provider cache, validates the full provider scope, normalises integer AUD cents, and calls one trusted ingestion transaction.
6. The ingestion RPC upserts connections, accounts and transactions atomically. Provider facts update, while manual categories remain unchanged and legal ownership stays fixed to the consent profile.
7. `bank-sync-scheduled` performs cached daily imports without consuming repeated explicit refreshes. It is callable only with a separate high-entropy scheduler secret. While the authenticated app is visible, it rereads the stored dataset every 30 seconds without clearing the screen. This does not issue a bank refresh every 30 seconds or bypass provider limits.
8. Consent expiry/revocation purges imported connections, accounts and transactions. Full disconnection also deletes the private provider profile after provider revocation.

Only account names, institution names, masked numbers, balances, transaction facts and consent/sync status reach public tenant tables. Unmasked account numbers, BSBs, bank credentials and provider tokens are not persisted. Provider identifiers are kept in RLS-protected private tables accessible only through service-role RPCs.

## Fail-closed gates

Live provider code is enabled only when all of the following are true:

1. `APP_ENV=production`.
2. `ALLOW_MOCK_DATA=false`.
3. `BASIQ_ENABLED=true`.
4. `BASIQ_BUSINESS_ONBOARDING_APPROVED=true`.
5. A server-only API key, an entity-keyed map of validated business profiles and an allowed-institution list exist.
6. The organisation is non-demo and the requesting user is an owner/admin.

Mock ingestion uses the inverse environment gates and only demo organisations. A production organisation can never silently fall back to fictional data.

## Refresh semantics

The product deliberately says “last successful sync,” not “real-time.” Basiq refreshes are asynchronous, Open Banking explicit refreshes are limited, and some institutions may have latency. The application triggers at most one explicit provider refresh every 90 minutes per legal-entity profile (at most 16 per day per profile), reads the latest provider cache between those refreshes, and uses scheduled cached imports for ordinary updates. A provider failure does not commit a partial snapshot.

## Remaining activation gates

Code completion is not provider authorisation. Before handling real account data, complete Basiq commercial/security onboarding and the approved CDR access model, verify the legal-entity structure, configure consent copy/scopes/retention, enable operational monitoring, and run the live pilot in [the production runbook](basiq-production-onboarding.md). Do not place a Basiq key, business profile, scheduler secret or service-role key in GitHub, a `VITE_*` variable or chat.
