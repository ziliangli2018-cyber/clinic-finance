# Security boundaries and deployment checks

This is an early functional foundation, not a production security certification. The hosted frontend must contain only public configuration. Authentication, tenant authorization, banking credentials and trusted mutations belong to the backend.

## Implemented controls

- RLS on all public and private application tables; tenant-filtered reads and no broad browser ledger writes.
- Composite organisation/entity/account foreign keys prevent cross-tenant references even when server code makes a mistake.
- Narrow security-definer functions with an empty `search_path`, schema-qualified application objects and explicit EXECUTE grants.
- Category mutations require owner/admin membership and create an audit event. Viewers cannot change categories or read the editor audit trail.
- Edge handlers validate JWTs with `auth.getUser(token)` and independently check membership. `organisationId` from the browser is only a requested scope, never proof of authority.
- Service-role credentials remain inside Edge Functions. Authenticated users cannot execute ingestion or read raw provider records/runtime flags. No provider credentials exist in the mock implementation.
- Atomic mock ingestion repeats authorization, applies idempotent transaction keys and preserves manual category choices.
- Multiple explicit mock gates fail closed, including a default production/mock-disabled database configuration.
- Private receipt storage, 10 MiB limit and a restricted MIME allowlist. Tenant members may read objects under their organisation prefix; upload/update/delete are not exposed in 0.1.
- Explicit allowed CORS origins; no wildcard credentialed origin. Responses disable caching. Server errors do not disclose financial payloads, secrets or JWTs.

## Deployment configuration

The source repository is public. The GitHub Pages workflow only supports `hosted-demo` or `production`, both of which require an HTTPS Supabase endpoint and public project key. Signed-out visitors see a sign-in screen; no financial data is loaded before authentication. The local browser-only demo is never a Pages deployment option. Hosting configuration errors stop the build instead of bypassing sign-in. Do not put a shared password, password hash, access token or private records in source code or a frontend build variable.

Hosted builds do not offer public registration. Disable new-user signup in the hosted Supabase Auth service as well; hiding the form alone is not an access control. Provision the owner's account through the Supabase administration flow and let the owner set their own password. Organisation membership and RLS still enforce record access even if an unrecognised account were created. Keep real financial data out of the separate hosted demo project.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public client configuration. They are safe to ship only because RLS and server authorization enforce access. The service-role key bypasses RLS and must never appear in `VITE_*`, static bundles, checked-in files, browser storage, logs or screenshots. Keep future bank/OCR provider secrets in backend secret storage.

Use a dedicated Supabase project for demo data and a different project for production. Apply only migrations to production; local `seed.sql` explicitly enables mock mode and must not be applied there. Keep the production runtime config at its migration defaults and set Edge `APP_ENV=production`, `ALLOW_MOCK_DATA=false`. Limit `CORS_ALLOWED_ORIGINS` to the actual deployed frontend origin. Configure Supabase Auth Site URL and redirect allowlist for the deployed frontend; hash routes do not need broad wildcard URL allowances.

`verify_jwt=false` in function configuration delegates token verification to the handler's mandatory remote `getUser` check. The handler never authorises a decode-only JWT, API key alone, anonymous request or claimed user ID in the request body. This supports current asymmetric signing keys without relying on the legacy gateway JWT verifier. CORS is a browser restriction and is not used as an authorization control.

## Before real financial data

Complete threat modelling, an independent security review, deployment access/MFA policy, key rotation/revocation process, backup/restore testing, incident response, retention/deletion rules and application rate limiting. Define who can invite members and change roles before implementing a membership admin UI. Current membership provisioning is an administrator-controlled database operation. Add operational monitoring and durable failed-job handling; error responses currently provide safe failure reporting but no external alerting.

Receipt storage has access controls but no upload or OCR workflow. No malware scanning or document extraction is implemented. No patient identifiers should be ingested. Economic indicators and forecasting are empty foundations; demo assumptions are not authenticated external observations or accounting/tax guidance.

The pgTAP suite exercises actual database roles for cross-tenant reads/writes, viewer restrictions, the server-only ingestion boundary, private tables and production mock rejection. Deno tests exercise mock gating and tenant-scoped identifiers. Passing them verifies those tested properties; it does not replace review of deployed secrets, Auth settings, provider contracts or operating procedures.

References: [Supabase user authentication](https://supabase.com/docs/reference/javascript/auth-getuser), [Edge authentication headers](https://supabase.com/docs/guides/functions/auth-headers), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [private Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
