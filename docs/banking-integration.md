# Banking integration boundary

Version 0.1 implements a deterministic mock provider only. It does not connect to a bank, collect internet-banking credentials, initiate payments, store real consent tokens or claim a Basiq/CDR integration is operational.

The browser uses the public Supabase key and its signed-in user session. `bank-sync` validates that session against Auth, checks owner/admin membership for the supplied organisation, verifies the organisation is explicitly a demo, and selects the server provider. The request cannot select a service-role identity, submit ledger data or override environment flags.

The backend `BankProvider` interface lives in `supabase/functions/_shared/provider.ts`. Providers return normalised data to a trusted ingestion boundary. The mock adapter derives records from the same pure deterministic generator used by the demo UI and rekeys organisation-owned IDs per tenant. Categories retain their shared catalogue IDs. A retry updates existing records by provider identity and preserves manual categorisation; it does not duplicate transactions. Missing mock connections are created during first sync, so an empty demo organisation can onboard successfully.

Mock generation requires **all** of these gates:

1. Edge `APP_ENV` is explicitly `development` or `demo`.
2. Edge `ALLOW_MOCK_DATA` equals `true`.
3. The organisation is marked `is_demo=true`.
4. Database `private.runtime_config` explicitly enables mock data in development/demo.
5. The authenticated user is an owner/admin of that organisation, checked again at ingestion.

Missing or misspelled configuration fails closed. `APP_ENV=production` rejects mock generation even if the allow flag is accidentally set. The Basiq adapter is intentionally unimplemented and returns HTTP 501. Existing nonmock connections also receive 501 rather than silently switching providers.

## A future Australian bank-data provider

Basiq is an architectural candidate, not an approved or contracted production integration. Before implementing live bank ingestion, validate the selected provider's current Australian coverage, consent model, commercial terms, security requirements and applicable obligations with the provider and appropriate advisers. The exact accreditation/representative arrangement depends on the chosen integration and business role; this repository does not assert compliance.

The implementation needs hosted consent and revocation flows, encrypted server-side token storage with rotation, webhook signature verification and replay protection, connection health/error handling, cursor-based incremental sync, pending-to-posted reconciliation, rate limits/retries, source-account identity, deletion/retention procedures and operational monitoring. Reconcile balances and provider transaction identifiers against the provider's sandbox before releasing. Extend the normalised adapter and trusted ingestion RPC; do not place a provider API key or access token in browser code.

The existing job, raw-record and audit tables are foundations. Durable scheduling, webhook ingestion and receipt/economic processing are not implemented. Provider payload retention and access controls must be decided before real data ingestion; the mock dataset is fictitious and contains no patient information.
