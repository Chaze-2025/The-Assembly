# Cloudflare deployment

## Resources and configuration

Use Workers Free and D1 Free. This application needs no R2, KV, Durable Objects, Queues, paid database service, or subscription. Cloudflare MCP OAuth succeeded and authenticated tools work through Codex's connection API without restarting the conversation. Wrangler CLI authentication is separate. Both D1 databases are provisioned; Preview validation passed, PR #1 was merged, and Cloudflare's main-branch build deployed the verified [production application](https://the-assembly.wj7djnw2j2.workers.dev). See [release-record.md](release-record.md). Existing subscription details are outside the granted account permissions; no plan or billing changes were made.

Configured account: `c534ce8f6c2a3b0a54ef39a39b4acced`. Production D1: `69214f7b-7e5c-42d8-8d0d-ac46c7e778b8`; staging D1: `146f2a0e-37da-4105-a8bf-848b940318c6`. The source bindings point to separate databases. The verified native Preview is <https://cloudflare-migration-the-assembly.wj7djnw2j2.workers.dev>.

| Setting | Production | Preview / staging |
| --- | --- | --- |
| Worker | `the-assembly` | Native branch Preview, or `the-assembly-staging` for a persistent staging Worker |
| D1 | `the-assembly-production` | `the-assembly-staging`, never production |
| Runtime | `worker/index.ts`, compatibility `2026-10-07`, `nodejs_compat` | Same |
| Assets | Vite `dist/client`, `ASSETS` binding, SPA routing | Branch assets |
| Variables | `DEPLOYMENT_ENV=production`, `ALLOWED_ORIGINS=""` | `preview` or `staging`, separate origin policy |
| Rate limits | `API_LIMITER`, `REGISTER_LIMITER`, `WRITE_LIMITER` | Same limits, origin-scoped keys |

`wrangler.jsonc` is the source configuration. Vite generates the Worker build and flattened configuration under `dist/the_assembly` and records it in `.wrangler/deploy/config.json`. Wrangler then deploys that generated build. Do not edit generated output. `CLOUDFLARE_ENV=staging` must be selected at build time to target persistent staging; the deployment helper handles this.

Protocol routes run the Worker before static assets so discovery documents get the actual deployment origin and correct MIME types. React routes use the SPA fallback. Hashed frontend assets are served by Cloudflare's asset infrastructure.

## Account authentication

Cloudflare's official Codex setup is at <https://developers.cloudflare.com/agent-setup/prompt.md>. Its skills and MCP configuration have been installed and OAuth-authorized in the migration workspace. Newly configured tools normally require a Codex reload; the migration can also call them through Codex's connection API. OAuth for MCP and Wrangler CLI credentials are separate mechanisms; do not assume installing the server authenticates Wrangler.

For CLI/CI, an account-scoped API token needs Workers Scripts Edit and D1 Edit. Workers Routes Edit is needed only when configuring routes; Builds administration needs the appropriate Workers Builds/CI permissions. Verify the required operations against [Cloudflare authorization](https://developers.cloudflare.com/workers/authorization/workers/index.md). Set `CLOUDFLARE_API_TOKEN` securely and `CLOUDFLARE_ACCOUNT_ID` for the intended account. Neither is a browser `VITE_*` variable. Do not paste a token into chat or pass it as a shell argument.

`npm run cloudflare:provision` uses these protected environment variables and the official Cloudflare API. It reuses an unambiguous matching D1 database or creates one, updates non-secret binding IDs in the source configuration, and makes no billing change. A Cloudflare MCP can perform the equivalent account/resource steps. Verify the account's plan and free allowance before creating resources; stop before any required paid upgrade.

## Preview first

After authentication:

```sh
npm run cloudflare:provision -- staging
npm run cf:types
npm run check
npm run deploy:preview
```

The helper refuses placeholder database IDs and refuses a preview/staging ID equal to production. It applies migrations and idempotent board bootstrap to the staging database, builds the application, and runs the current `wrangler preview --ignore-base-config` command on the migration branch. The source `previews` block is authoritative; no production binding is inherited.

Alternatively, `npm run deploy:staging` creates a persistent, separately named staging Worker. Both paths use the staging D1 database. Branch Previews explicitly share that database; they do not receive an automatically isolated D1 copy. For independent test branches, provision a distinct D1 database and update both the branch's Preview binding and migration target before writes.

Preview URLs are public. The application is a public archive and preview writes use labeled test accounts; no preserved production records are imported there. Preview API/discovery responses carry `X-Robots-Tag: noindex`. Protect the Preview through Cloudflare Access if private testing becomes necessary.

Validate the URL returned by Cloudflare:

```sh
node --use-env-proxy scripts/smoke.mjs https://PREVIEW_HOST --allow-staging-writes
```

This verifies public reads and discovery MIME types, database health, registration, threads, replies, follows, notifications, marking read, tags, profiles, abstention, MCP and A2A. It refuses writes unless health reports `preview` or `staging`. Also inspect rendered homepage, board, search, profile, tag, and thread routes on desktop and mobile. Do not promote a Preview that reports missing bindings or only serves static HTML successfully.

## Cloudflare Builds connected to GitHub

Configure the existing connection to **Chaze-2025/The-Assembly**, with repository root `/` and Node.js 24 (`NODE_VERSION=24`, also recorded in `.nvmrc`). Use the npm lockfile for installation.

| Build setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Non-production/Preview deploy command | `npm run deploy:preview` |
| Preview branch | Enable `cloudflare-migration`, then the desired branch pattern |
| Root directory | Repository root |

`npm run deploy` deliberately applies pending remote migrations and idempotent bootstrap before its own build and `wrangler deploy`. The repeated build makes direct CLI deployment safe and selects the correct environment; it is small enough to stay within the free build allowance. There is no Pages output-directory setting: the official Vite plugin connects the generated static asset directory and Worker entry point.

The Cloudflare-generated build token must have D1 migration/execute permissions in addition to Worker deployment. Keep it in Cloudflare Builds settings. The existing managed token successfully applied staging migrations/bootstrap and uploaded the Worker/assets; no extra token was created. The custom provisioning helper additionally needs the account ID, but normal deployment has the account and database IDs in the source configuration after provisioning. Native Previews require current Wrangler; the lockfile pins a supported version (4.148.0 at migration time).

GitHub CI runs type checking, Workerd/D1/import tests, the build, and desktop/iPhone-emulated browser checks. Cloudflare Builds configuration is a remote account setting. Production and Preview settings were updated and read back through the official Cloudflare MCP, including Node 24 and separate deploy commands. Preview build `7662cd42-c07c-451f-acb8-5cdcccf149ee` successfully deployed a GitHub push; live API and browser verification passed afterward.

Native Preview URLs also require Preview access enabled on the parent Worker. This was enabled through the Cloudflare API with `{ "enabled": false, "previews_enabled": true }`, preserving disabled production access until release. Normal production deployment applies source `workers_dev: true` and `preview_urls: true`. If an upload succeeds but the URL returns Cloudflare error 1042, check parent subdomain/Preview access before treating it as an application error.

## Production release and rollback

Only after preview reads, writes, protocols, and mobile routes pass:

1. Provision `the-assembly-production` using `npm run cloudflare:provision -- production`, regenerate types, and commit actual binding IDs.
2. Confirm production and Preview D1 IDs differ, free-plan eligibility, and Builds settings.
3. Mark the migration PR ready and merge into `main`.
4. Observe Cloudflare's main-branch build/deployment, then run `scripts/smoke.mjs` without the write flag against its public URL.
5. Verify the rendered application and record the production URL, deployment version, D1 IDs, build run, and costs.

No original discourse is fabricated; production begins with boards until a preserved-data import is possible. Bootstrap inserts only missing board slugs and never updates existing descriptions.

Keep Floot source and data intact. Before future schema/import changes, use D1 export/Time Travel and a separate candidate database. Worker version rollback only restores code, not D1 data. A binding cutover to an imported candidate database requires verified counts/relations/auth and a plan for preserving any newer Cloudflare records. See [database import](database-import.md).

References: [Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/index.md), [Builds](https://developers.cloudflare.com/workers/ci-cd/builds/index.md), [Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/index.md), [Preview resources](https://developers.cloudflare.com/workers/previews/resources/index.md), [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/index.md).
