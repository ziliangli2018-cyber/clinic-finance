# Local setup and GitHub Pages deployment

Version 0.3 supports a public browser-only demonstration and a separately activated authenticated production site on GitHub Pages. The public demo uses deterministic fictional data, saves changes in local browser storage and contains no banking credentials. Production uses Supabase plus the Basiq functions described in the [production banking runbook](basiq-production-onboarding.md); source deployment alone does not authorise or connect a bank.

## 1. Run the browser demo

Use Node.js 24 and run from the repository root:

```sh
npm ci
npm run dev
```

Open the address Vite prints, normally `http://localhost:5173`. The default is `development/mock`. It uses fictitious data and needs neither Docker nor bank credentials.

Validate and preview the static release:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

This explicit `demo/mock` build is also the default Pages deployment target. `npm run preview` serves files already in `dist/`; it does not start Supabase.

## 2. Run local Supabase

Install and start a Docker-compatible container runtime, such as Docker Desktop. The Supabase CLI starts Postgres, Auth, Storage and local supporting services in containers. This repository already includes `supabase/config.toml`; do not run `supabase init` over it. See the official [Supabase local CLI guide](https://supabase.com/docs/guides/local-development/cli/getting-started).

The following commands use the same pinned CLI release as CI. An installed CLI of that version may be used instead of `npx supabase@2.117.0`.

```sh
npx supabase@2.117.0 start
npx supabase@2.117.0 status
```

The first start downloads container images and applies repository migrations and local seed configuration. The seed enables development mock provisioning, without inserting real records. It is not a production seed.

Create an ignored file named `.env.development.local` at the repository root:

```dotenv
VITE_APP_ENV=development
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=PASTE_LOCAL_PUBLIC_OR_ANON_KEY
VITE_BASE_PATH=/
```

Copy only the public/publishable key, or legacy `anon` key, from local Supabase status. Never copy the `service_role` or secret key into any `VITE_*` value. The public key identifies a project; authenticated user access tokens and RLS authorise records.

Create a second ignored file, `supabase/functions/.env.local`, from `supabase/functions/.env.example`. Its development settings are:

```dotenv
APP_ENV=development
ALLOW_MOCK_DATA=true
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Supabase supplies local backend connection and service-role credentials to the Edge Runtime. Keep those credentials out of the frontend file. Serve the functions in a separate terminal:

```sh
npx supabase@2.117.0 functions serve --env-file supabase/functions/.env.local
```

Restart `npm run dev` after changing environment files. In the interface, create a local account or sign in, create a demo organisation, then run mock synchronisation. Authentication, tenant creation and sync are distinct operations. The backend sync persists fictitious accounts and transactions; subsequent Supabase reads use RLS.

If email confirmation is enabled in your local Auth configuration, use the local email inbox printed by `supabase status`. Do not use real bank credentials or real customer data for development.

### Reset and verify the local database

`db reset` **deletes the local database contents** and reapplies migrations and the local seed. Use it only when recreating disposable development data:

```sh
npx supabase@2.117.0 db reset
npx supabase@2.117.0 test db
deno task --config supabase/functions/deno.json check
```

The Deno command requires Deno 2. Database tests exercise tenant access and supported write paths. A passing TypeScript check alone does not verify RLS. See the official [Supabase testing guide](https://supabase.com/docs/guides/local-development/cli/testing-and-linting) for how the pgTAP runner works.

With local Edge Functions running, `npm run test:integration` exercises real Auth, onboarding, sync retries, manual category preservation and cross-tenant rejection. It reads the same development public configuration as Vite, including `.env.development.local`. With `npm run dev` also running on port 5173, `npm run test:local-ui` tests signup, onboarding, sync, session persistence and sign-out in Chromium. Run `npx playwright install chromium` first. Both tests create fictitious local users and organisations; they refuse hosted backend URLs.

For static browser checks, build with `VITE_BASE_PATH=/clinic-finance/` and run `npm run test:e2e`. CI performs this automatically. These checks include mobile rendering, filters, categorisation, account links and refresh at a repository subpath.

To stop the local services:

```sh
npx supabase@2.117.0 stop
```

To return to browser-only mock mode, remove or rename `.env.development.local` and restart Vite. Do not put its Supabase setting into a shared `.env.local` file unless it should also apply to other Vite modes.

## 3. Configure the public GitHub repository

The authorised deployment uses the public [clinic-finance repository](https://github.com/ziliangli2018-cyber/clinic-finance) and the project site at [Clinic Finance](https://ziliangli2018-cyber.github.io/clinic-finance/). Keep source, migrations, lockfiles, tests and documentation in GitHub. Do not upload `node_modules/`, `dist/`, ignored environment files, local database volumes or real financial records. Review the full Git history for secrets and private records before changing repository visibility.

Use the existing Git repository and remote; do not create a second repository. The default public demo needs no hosted backend configuration. The optional Supabase configuration later in this document applies only when deliberately switching deployment modes.

In the repository settings:

1. Open **Pages** and choose **GitHub Actions** as the build and deployment source.
2. Pushes to `main` always publish the `public-demo` environment. A manual workflow run can deliberately choose `public-demo`, `hosted-demo` or `production`.
3. The public demo needs no Supabase variables. For a deliberate hosted mode, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the hosted project's public values. Leave `PAGES_BASE_PATH` unset for the ordinary project address; set it to `/` for a root/custom domain.
4. Configure a ruleset or branch protection for `main`, requiring pull requests and both validation jobs where the repository plan supports it.
5. Configure the `github-pages` environment to allow deployments only from `main`. Add required reviewers if your release process needs a separate approval gate.
6. Push approved code to `main`, or run **Deploy GitHub Pages** manually on `main`.

The workflow itself never deploys a pull request or a manually selected non-main branch. Branch protection determines who can approve or push code; a workflow cannot substitute for repository governance.

### Public source and private data

The source repository and Pages assets are public. The default public demo intentionally bundles only fictitious records and keeps user changes on the device. Do not enter real financial records into it. A shared password embedded in JavaScript cannot protect data. See [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Optional hosted modes use individual Supabase email-and-password accounts, with database RLS and trusted backend checks enforcing access to each organisation's records. Disable public signup in the hosted Supabase Auth settings and provision approved users through a trusted administration flow. Hiding the signup button is only a UI measure; the server setting is required.

## Workflow behaviour

| Workflow           | Trigger                                                          | Result                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`         | Pull requests targeting `main`, or reusable call from deployment | Node 24 install, type checking, linting, unit tests, mock/hosted-demo/production builds, browser and sign-in gate checks, Deno checks/tests, fresh local Supabase migration and database tests |
| `deploy-pages.yml` | Push to `main` or manual run on `main`                           | Calls the complete validation workflow, builds the selected environment, uploads only `dist/` and publishes to Pages                                                                           |

Validation jobs have repository read access only and use an isolated local database with invented test records. Hosted-demo and production compilation checks use a synthetic public project URL/key and do not contact a hosted backend or deploy their output. Hosted-demo browser checks verify that signed-out deep links and reloads remain behind the sign-in gate. Build metadata access adds `pages: read`. Only the final deployment job receives `pages: write` and `id-token: write`. Checkout does not persist credentials. Actions are pinned to commit SHAs; Dependabot proposes dependency and action updates.

The workflow follows the official [GitHub Pages custom workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). It creates no hosted Supabase project, runs no production migrations and stores no production backend credentials in GitHub.

## Public configuration and secrets

| Setting                                                    | Location                         | Purpose                                                                |
| ---------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `VITE_APP_ENV`                                             | Frontend build                   | `development`, `demo` or `production`                                  |
| `VITE_DATA_MODE`                                           | Frontend build                   | `mock` for public demo, `supabase` for hosted modes                    |
| `VITE_SUPABASE_URL`                                        | Frontend public variable         | Supabase project endpoint                                              |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                            | Frontend public variable         | Public/publishable or legacy anon key                                  |
| `VITE_BASE_PATH`                                           | Frontend build                   | Asset path with leading and trailing `/`                               |
| `deploy_env`                                               | Manual Pages workflow input      | `public-demo`, `hosted-demo` or `production`; pushes use `public-demo` |
| `PAGES_BASE_PATH`                                          | GitHub repository variable       | Optional override for generated asset path                             |
| `APP_ENV`, `ALLOW_MOCK_DATA`, `CORS_ALLOWED_ORIGINS`       | Edge Function environment        | Backend mode and accepted browser origins                              |
| `BASIQ_ENABLED`, onboarding flag, allowed institutions     | Supabase Edge Function secrets   | Fail-closed provider activation                                        |
| Basiq API key, business profile and scheduler secret       | Supabase Edge Function secrets   | Consent, provider access and daily scheduler authentication            |
| Supabase service-role key and all provider/API credentials | Trusted backend environment only | Privileged server operations                                           |

Every `VITE_*` value must be treated as public, even if entered in a GitHub “secret” field. Vite embeds frontend values in downloadable assets. CORS restricts browser origins; authentication, membership checks and RLS still enforce access.

## 4. Optional: configure the hosted Supabase demo

The selected demo project is `clinic-finance-demo`, reference `gackqbplslckvdyijivb`, in Sydney (`ap-southeast-2`). Its public endpoint is `https://gackqbplslckvdyijivb.supabase.co`. Use a separate Supabase project for future production data.

1. Authenticate the Supabase CLI through its supported login flow, then link the intended project. Verify the project reference before applying the repository migrations. Store administrative credentials only in a trusted local credential store or backend secret store; never in `VITE_*` variables or committed files. Do not apply the local development seed to a hosted project.
2. Enable email-and-password authentication. Set the Auth site URL and permitted redirect URL to `https://ziliangli2018-cyber.github.io/clinic-finance/`. Disable new public user signup in Supabase Auth and provision the approved owner account through a trusted administration flow. The hosted interface offers sign-in only; account creation is available in the local development interface.
3. Configure Edge Function settings as shown below. Supabase provides the functions' built-in backend credentials; do not copy a service-role key into the frontend.
4. Apply the explicit demo runtime SQL below to this demo project's database. Migrations default to production with mocks disabled, so frontend environment variables alone cannot enable mock ingestion.
5. Deploy `bank-sync`, `transaction-processing`, `receipt-processing` and `economic-data-sync`. The latter three remain authenticated placeholders; deployment does not enable their future integrations.
6. Set GitHub's public URL/key variables and manually run the Pages workflow with `deploy_env=hosted-demo`. The hosted-demo build requires an HTTPS Supabase endpoint and a public/publishable or legacy anon key.
7. Verify unauthenticated rejection, tenant isolation, sign-in, sign-out and direct hash-route reloads. Sign in as the approved owner, create a demo organisation and run mock synchronisation to provision fictitious accounts and transactions.

Hosted demo Edge Function settings:

```dotenv
APP_ENV=demo
ALLOW_MOCK_DATA=true
CORS_ALLOWED_ORIGINS=https://ziliangli2018-cyber.github.io
```

CORS uses the browser origin without `/clinic-finance/`; Auth redirect URLs include the application base path.

Apply only to the selected demo project after its migrations:

```sql
update private.runtime_config
set environment = 'demo', allow_mock_data = true
where singleton = true;
```

For a local preview of the hosted frontend, supply that project's public URL/key in an ignored `.env.hosted-demo.local`, then run `npm run build:hosted-demo`. If testing authenticated function calls locally, add the exact preview origin to the demo backend's allowed origins for that test and remove it afterward. See [banking integration](banking-integration.md) for the additional tenant and membership checks used by mock ingestion.

### Production deployment

Apply migrations to a separate production project without the local seed or demo runtime SQL. Configure `APP_ENV=production`, `ALLOW_MOCK_DATA=false`, an exact browser-origin allowlist, Auth and approved users. Deploy `bank-connect`, `bank-sync` and `bank-sync-scheduled`, then set GitHub's public URL/key variables and manually run the Pages workflow with `deploy_env=production`.

Both hosted-demo and production builds fail closed when required public project configuration is missing or mock mode is requested. Neither uses the browser mock dataset at runtime or provides an unauthenticated fallback. Live consent remains disabled until the server-only Basiq gates are satisfied. Follow the [production banking runbook](basiq-production-onboarding.md) for secrets, scheduling, bank prerequisites and the mandatory three-account pilot.

## Project paths, deep links and custom domains

The workflow defaults `VITE_BASE_PATH` to `/<repository-name>/`. Hash routes such as `https://OWNER.github.io/clinic-finance/#/transactions` survive refresh because Pages receives the existing `/clinic-finance/` index path. The fragment is handled in the browser.

To move to a custom domain:

1. Configure and verify the domain in GitHub Pages, add the DNS records required by GitHub and enable HTTPS.
2. Set `PAGES_BASE_PATH=/` and rebuild.
3. Update Supabase Auth site/redirect URLs and the backend origin allowlist to the new HTTPS origin.
4. Check a direct deep link, refresh it, load an account page and complete a sign-in cycle.

No route or component rewrite is required. Use the actual site URL reported by GitHub and choose the base path it requires.

## Common problems

| Symptom                                           | Check                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages configuration or deployment returns 404/403 | Public repository, Pages enabled, Actions source selected, `github-pages` environment permits `main`                                          |
| Interface loads without styling or scripts        | `PAGES_BASE_PATH` matches the published site and ends in `/`; rebuild after changing it                                                       |
| Refresh fails                                     | Use the generated hash route and the correct repository base, not a server-style `/transactions` path                                         |
| Supabase UI shows an error instead of demo data   | Check local services, frontend public URL/key, authentication session and Edge Function logs; Supabase mode deliberately has no mock fallback |
| Mock sync is rejected                             | Non-production backend mode, explicit mock flag, database runtime settings, demo organisation and editor membership all required              |
| Local function request fails CORS                 | Exact origin, including port, is in `CORS_ALLOWED_ORIGINS`; restart function serving after changes                                            |
| Hosted-demo or production build refuses to run    | Supply an HTTPS Supabase URL and public key, and use Supabase mode; do not enable frontend mocks to bypass the check                          |
| Hosted sign-in fails or no account exists         | Provision an approved Auth user, check its password/confirmation status and public project configuration; keep public signup disabled         |
| Local Supabase cannot start                       | Docker running, sufficient disk space and the configured ports available                                                                      |

The production banking scheduler endpoint is implemented but does not schedule itself. Configure one authenticated daily backend invocation as described in the runbook; never rely on an open browser tab. Receipt and economic-data workers remain placeholders.
