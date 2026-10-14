# Production banking runbook

This runbook activates the code for the Kilcoy NAB accounts, Burpengary NAB accounts and BOQ Specialist practice loan. It intentionally separates code deployment from permission to handle Consumer Data Right data.

## 1. Confirm the legal-entity model

Kilcoy and Burpengary are separate legal entities. The application therefore creates a separate Basiq Business Consumer user, consent history and refresh limit for each clinic. An imported connection, account and transaction remains attached to the entity whose consent created it; the browser cannot move it across clinic boundaries.

The BOQ Specialist loan must be connected from the card for its actual legal borrower. Use Group finance only if that entity is the borrower. If Kilcoy or Burpengary is the borrower, connect the loan from that clinic's card. Do not infer ownership from the account nickname, repayment account or reporting preference.

For each profile, the legal business name, ABN/ACN, registered address and verification date supplied to the backend must exactly match the business Basiq approves.

## 2. Complete provider and bank prerequisites

1. Apply for a Basiq Business Application and complete its commercial, security and CDR access-model review. Confirm the approved model in writing; do not infer accreditation from an API key.
2. Configure the Basiq consent experience for business accounts, required account/transaction scopes, a retrieval period no longer than the approved consent term, and **Allow Multiple Connections**.
3. Enable and verify NAB institution `AU01001` and BOQ Specialist institution `AU20130` in the production Basiq application.
4. Configure the Consent UI success/return URL as `https://ziliangli2018-cyber.github.io/clinic-finance/#/settings`. Returning in the same browser tab preserves the non-secret pending entity marker and starts initial import automatically. A root-page return is also routed to banking settings when that marker is present.
5. For NAB, ensure the nominated authorised user has NAB Internet Banking (NAB Connect alone is insufficient), an active NAB ID and SMS mobile.
6. For a company/trust BOQ Specialist account, nominate a representative with authority, digital banking access, mobile and email. Confirm the exact loan is visible in BOQ Specialist Online Banking or its app.

Official references: [Basiq Business Consumer Consent](https://api.basiq.io/docs/business-consumer-consent), [Basiq go-live checklist](https://api.basiq.io/docs/go-live-checklist), [NAB Open Banking](https://www.nab.com.au/customer-notices/open-banking), and [BOQ Specialist Open Banking](https://www.boqspecialist.com.au/help-and-support/important-information/open-banking).

## 3. Create the production Supabase project

The production project is `clinic-finance-production` (`hwmljlkrqbidjnlhfako`) in Sydney (`ap-southeast-2`). It is separate from the hosted demo. Establish named owners, MFA, billing, backups/PITR, log retention and an incident contact.

1. Disable public Auth signup and provision only approved users.
2. Set the Auth site URL and redirect allowlist to the final HTTPS GitHub Pages/custom-domain URL.
3. Link the CLI to the verified production project.
4. Apply migrations without `supabase/seed.sql` or any demo runtime update.
5. Confirm `private.runtime_config` remains `environment='production'` and `allow_mock_data=false`.

Typical deployment commands, run from a trusted administrator workstation, are:

```sh
npx supabase@2.117.0 link --project-ref YOUR_PRODUCTION_PROJECT_REF
npx supabase@2.117.0 db push
npx supabase@2.117.0 functions deploy bank-connect
npx supabase@2.117.0 functions deploy bank-sync
npx supabase@2.117.0 functions deploy bank-sync-scheduled
```

Also deploy the other functions only if their documented placeholder behaviour is required. A successful CLI deployment does not prove bank access.

## 4. Install secrets directly in Supabase

Never paste production values into source code, GitHub, a `VITE_*` setting, issue, pull request or chat. Use Supabase's secret-management command or dashboard from the trusted workstation. Required server-only settings are:

```dotenv
APP_ENV=production
ALLOW_MOCK_DATA=false
BASIQ_ENABLED=true
BASIQ_BUSINESS_ONBOARDING_APPROVED=true
BASIQ_API_KEY=PRODUCTION_SERVER_KEY
BASIQ_ALLOWED_INSTITUTION_IDS=AU01001,AU20130
BASIQ_AUTOMATIC_SYNC=true
BANK_SYNC_SCHEDULER_SECRET=AT_LEAST_32_RANDOM_CHARACTERS
CORS_ALLOWED_ORIGINS=https://YOUR_FINAL_FRONTEND_ORIGIN
BASIQ_BUSINESS_PROFILES={"ENTITY_UUID":{...approved verified business profile...}}
```

`BASIQ_BUSINESS_PROFILES` is a JSON object keyed by the entity UUID created in the live workspace. Add separate entries for Kilcoy and Burpengary. Add the selected loan borrower only if it is not already one of those profiles. Every entry uses Basiq's business-user fields: `businessName`, `businessIdNo`, `businessIdNoType` (`ABN` or `ACN`), `businessAddress`, `verificationStatus:true` and `verificationDate` in `DD/MM/YYYY` form. Treat the full map as protected configuration even though some registry facts may be public.

The operator's decision to use Basiq is not Basiq approval. Keep `BASIQ_ENABLED=false` and `BASIQ_BUSINESS_ONBOARDING_APPROVED=false` until Basiq has issued the production server key and confirmed the Business Consumer consent model in writing.

Generate the scheduler secret with a cryptographically secure password manager. Supabase automatically injects its built-in URL and service-role credentials; never place those in the frontend.

## 5. Configure daily backend sync

Schedule one daily POST to the deployed `bank-sync-scheduled` Edge Function. Keep the scheduler secret in Supabase Vault or another server-side secret store and send it only as the `x-scheduler-secret` header. Do not call this endpoint from the browser or GitHub Pages.

The scheduled function uses provider-cached data and processes all approved profiles. The app triggers at most one explicit provider refresh per 90 minutes per legal-entity profile (16 per day); requests between those refreshes import the latest provider cache. Monitor non-200/207 responses and the returned `failed` count without logging financial payloads.

## 6. Publish the authenticated frontend

Add only these public values as GitHub repository variables:

- `PRODUCTION_SUPABASE_URL`
- `PRODUCTION_SUPABASE_PUBLISHABLE_KEY`
- `PAGES_DEPLOY_ENV=production` only when every go-live gate below is ready
- optional `PAGES_BASE_PATH`

The workflow maps the two production values to downloadable `VITE_*` browser configuration only during a production build. They must be the public project URL and publishable/anon key, never a secret or service-role key. Leave `PAGES_DEPLOY_ENV` unset or `public-demo` while the existing URL remains the fictional demo. At approved go-live, set it to `production`, then run **Deploy GitHub Pages** on `main` with `deploy_env=production`; later pushes will keep rebuilding production instead of replacing it with the demo. Update `CORS_ALLOWED_ORIGINS` and Supabase Auth redirects if GitHub reports a different final origin. The Pages workflow deploys only static assets and never receives Basiq/server secrets.

## 7. Run a controlled live pilot

Use an approved owner account and complete these checks before relying on the dashboard:

1. Create the workspace and confirm the three empty entities: Kilcoy, Burpengary and Group finance.
2. From the Kilcoy card, connect NAB and select only accounts legally owned by Kilcoy. Repeat from the Burpengary card for accounts legally owned by Burpengary.
3. Confirm masked account identities, legal-entity grouping, current/available balances and a sample of transaction dates/amounts against NAB.
4. Refresh both profiles and confirm every account remains under the consenting clinic. There is no cross-entity reassignment control.
5. From the confirmed borrower's card, add BOQ Specialist, select the exact loan and refresh.
6. Confirm the loan appears as a liability under that borrower and is excluded from Available cash. If the wrong profile was used, disconnect and repeat consent under the correct borrower; do not relabel it in the database.
7. Categorise test transactions, refresh, and confirm manual categories persist.
8. Add or expose a test account at an existing institution, repeat consent/account election, and confirm it appears without code changes.
9. Exercise consent management, expiry/renewal, revocation and full disconnect. Confirm revoked imported records are deleted and an audit event remains.
10. Compare daily scheduled sync timestamps and provider/bank balances for several business days, including a weekend.

BOQ Specialist does not publish a product-by-product compatibility matrix, so the exact loan must pass this pilot before it is represented as supported. Review the government's current [CDR data-holder rectification schedule](https://www.cdr.gov.au/for-providers/rectification-schedules/rectification-schedule-active-data-holders-gaps) during sign-off for known latency/coverage issues.

## 8. Operational sign-off

Do not mark the system operational until all of the following have an owner and evidence:

- Basiq commercial/security approval and approved CDR access model.
- Privacy/CDR policy, consent purpose, retention/deletion and correction processes.
- Tested production backup/restore and incident response.
- Alerts for provider failure, expired/expiring consent and failed scheduled imports.
- Reconciliation evidence for all three accounts.
- User-access review and offboarding procedure.
- A statement in the interface/support material that updates are periodic Open Banking syncs, not guaranteed real-time streaming.

Keep a separate public demo available for training. Never copy production records into the demo or test fixtures.
