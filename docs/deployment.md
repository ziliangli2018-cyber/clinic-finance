# Local setup and GitHub Pages deployment

Version 0.1 is designed to run locally first. The immediate demo needs Node.js only. Local Supabase adds authentication, database persistence and trusted mock ingestion. A hosted Supabase project can be configured later; no live banking integration is enabled by these steps.

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

The build is an explicit `demo/mock` release. `npm run preview` serves files already in `dist/`; it does not start Supabase.

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

With local Edge Functions running, `npm run test:integration` exercises real Auth, onboarding, sync retries, manual category preservation and cross-tenant rejection. It reads local public config from `.env.local`. With `npm run dev` also running on port 5173, `npm run test:local-ui` tests signup, onboarding, sync, session persistence and sign-out in Chromium. Run `npx playwright install chromium` first. Both tests create fictitious local users and organisations; they refuse hosted backend URLs.

For static browser checks, build with `VITE_BASE_PATH=/clinic-finance/` and run `npm run test:e2e`. CI performs this automatically. These checks include mobile rendering, filters, categorisation, account links and refresh at a repository subpath.

To stop the local services:

```sh
npx supabase@2.117.0 stop
```

To return to browser-only mock mode, remove or rename `.env.development.local` and restart Vite. Do not put its Supabase setting into a shared `.env.local` file unless it should also apply to other Vite modes.

## 3. Configure the private GitHub repository

Keep the full source tree, migrations, lockfiles, tests and documentation in a new private repository named `clinic-finance`. Do not upload `node_modules/`, `dist/`, ignored environment files, local database volumes or real financial records.

If the repository has not yet been created, sign in with GitHub CLI, initialise and commit the local source, then create it:

```sh
gh auth login
git init -b main
git add .
git commit -m "Build clinic finance v0.1"
gh repo create clinic-finance --private --source=. --remote=origin --push
```

If a Git repository or remote already exists, use it instead of repeating initialisation or repository creation. Review `git status` before committing.

In the repository settings:

1. Open **Pages** and choose **GitHub Actions** as the build and deployment source.
2. Under **Secrets and variables → Actions → Variables**, set `DEPLOY_ENV` to `demo` for Version 0.1. Unset also defaults to `demo`.
3. Leave `PAGES_BASE_PATH` unset for the ordinary project address. Set it to `/` for a root/custom domain.
4. Configure a ruleset or branch protection for `main`, requiring pull requests and both validation jobs where the repository plan supports it.
5. Configure the `github-pages` environment to allow deployments only from `main`. Add required reviewers if your release process needs a separate approval gate.
6. Push approved code to `main`, or run **Deploy GitHub Pages** manually on `main`.

The workflow itself never deploys a pull request or a manually selected non-main branch. Branch protection determines who can approve or push code; a workflow cannot substitute for repository governance.

### Private repository and site visibility

GitHub Pages can publish from private repositories on GitHub Pro, Team or Enterprise plans. GitHub Free normally supports Pages from public repositories. Keep this repository private if Pages is unavailable; enable a suitable plan before publishing. See [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Repository privacy and website access are separate. A Pages site is generally public even when its source repository is private. Restricted-access Pages for private/internal organisation project repositories requires GitHub Enterprise Cloud. See [Pages access control](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site).

The demo contains only invented records. For a future production site, all bundled assets and public configuration are downloadable, while real financial records must stay behind Supabase authentication and RLS. A private repository is not an application access control.

## Workflow behaviour

| Workflow           | Trigger                                                          | Result                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`         | Pull requests targeting `main`, or reusable call from deployment | Node 24 install, type checking, linting, unit tests, demo and production compilation, Deno check, fresh local Supabase migration and database tests |
| `deploy-pages.yml` | Push to `main` or manual run on `main`                           | Calls the complete validation workflow, builds the selected environment, uploads only `dist/` and publishes to Pages                                |

Validation jobs have repository read access only and use an isolated local database with invented test records. The production compilation check uses a synthetic public project URL/key and does not contact a hosted backend or deploy its output. Build metadata access adds `pages: read`. Only the final deployment job receives `pages: write` and `id-token: write`. Checkout does not persist credentials. Actions are pinned to commit SHAs; Dependabot proposes dependency and action updates.

The workflow follows the official [GitHub Pages custom workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). It creates no hosted Supabase project, runs no production migrations and stores no production backend credentials in GitHub.

## Public configuration and secrets

| Setting                                                    | Location                         | Purpose                                            |
| ---------------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| `VITE_APP_ENV`                                             | Frontend build                   | `development`, `demo` or `production`              |
| `VITE_DATA_MODE`                                           | Frontend build                   | `mock` or `supabase`; production requires Supabase |
| `VITE_SUPABASE_URL`                                        | Frontend public variable         | Supabase project endpoint                          |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                            | Frontend public variable         | Public/publishable or legacy anon key              |
| `VITE_BASE_PATH`                                           | Frontend build                   | Asset path with leading and trailing `/`           |
| `DEPLOY_ENV`                                               | GitHub repository variable       | `demo` or `production`; default `demo`             |
| `PAGES_BASE_PATH`                                          | GitHub repository variable       | Optional override for generated asset path         |
| `APP_ENV`, `ALLOW_MOCK_DATA`, `CORS_ALLOWED_ORIGINS`       | Edge Function environment        | Backend mode and accepted browser origins          |
| Supabase service-role key and all provider/API credentials | Trusted backend environment only | Privileged server operations                       |

Every `VITE_*` value must be treated as public, even if entered in a GitHub “secret” field. Vite embeds frontend values in downloadable assets. CORS restricts browser origins; authentication, membership checks and RLS still enforce access.

## Later: connect a hosted backend

This is a future deployment path, not required for the selected local setup. Use separate Supabase projects for hosted development and production.

1. Create the intended Supabase project and configure authentication, email delivery and deployment-specific site/redirect URLs.
2. Use the Supabase CLI to link the intended project and apply the migrations. Inspect the target project before any database write. Do not run the local seed on production.
3. Configure backend environment and secrets using Supabase's secret store. Production requires `APP_ENV=production`, `ALLOW_MOCK_DATA=false`, an exact browser-origin allowlist, and production database runtime settings.
4. Deploy the four Edge Functions. Existing placeholder endpoints remain unavailable; deploying them does not enable future integrations.
5. Verify unauthenticated rejection, cross-tenant denial and supported authenticated reads against the hosted project before publishing.
6. Set repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to that project's **public** values, then change `DEPLOY_ENV=production` and deploy `main`.

The production build fails closed when its required public project configuration is missing or mock mode is requested. It does not ship the frontend mock dataset. Production cannot provision demo organisations or refresh the mock provider. Until live provider onboarding is implemented and authorised, production may have no financial data; that is expected.

For a hosted demo backed by Supabase, use a separate non-production project and follow the explicit backend demo configuration in [banking integration](banking-integration.md). The provided Pages workflow intentionally exposes only browser-demo and production deployment choices; adding a hosted Supabase demo should be an explicit reviewed environment configuration.

## Project paths, deep links and custom domains

The workflow defaults `VITE_BASE_PATH` to `/<repository-name>/`. Hash routes such as `https://OWNER.github.io/clinic-finance/#/transactions` survive refresh because Pages receives the existing `/clinic-finance/` index path. The fragment is handled in the browser.

To move to a custom domain:

1. Configure and verify the domain in GitHub Pages, add the DNS records required by GitHub and enable HTTPS.
2. Set `PAGES_BASE_PATH=/` and rebuild.
3. Update Supabase Auth site/redirect URLs and the backend origin allowlist to the new HTTPS origin.
4. Check a direct deep link, refresh it, load an account page and complete a sign-in cycle.

No route or component rewrite is required. If using private Enterprise Pages, use the actual site URL reported by GitHub and choose the base path it requires.

## Common problems

| Symptom                                           | Check                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages configuration or deployment returns 404/403 | Pages enabled, Actions source selected, private-repository plan eligible, `github-pages` environment permits `main`                           |
| Interface loads without styling or scripts        | `PAGES_BASE_PATH` matches the published site and ends in `/`; rebuild after changing it                                                       |
| Refresh fails                                     | Use the generated hash route and the correct repository base, not a server-style `/transactions` path                                         |
| Supabase UI shows an error instead of demo data   | Check local services, frontend public URL/key, authentication session and Edge Function logs; Supabase mode deliberately has no mock fallback |
| Mock sync is rejected                             | Non-production backend mode, explicit mock flag, database runtime settings, demo organisation and editor membership all required              |
| Local function request fails CORS                 | Exact origin, including port, is in `CORS_ALLOWED_ORIGINS`; restart function serving after changes                                            |
| Production build refuses to run                   | Supply the public Supabase URL/key and use Supabase mode; do not enable mocks to bypass the check                                             |
| Local Supabase cannot start                       | Docker running, sufficient disk space and the configured ports available                                                                      |

Scheduled bank refresh, receipt workers and economic imports are not enabled in this release. Add them as trusted backend jobs with retries and audit records; never rely on an open browser tab to run them.
