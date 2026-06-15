# Deployment

ModernScienceReview is intended to run from Railway with two isolated environments:

- Staging: test site for uploads and review-flow validation.
- Production: public site at `https://modernscience.review`.

Both environments should deploy the same GitHub branch or release, but they must use different databases so staging papers and reviews never appear on production.

## Railway Services

Each environment needs three Railway services:

- `@workspace/scireview`: the public web service.
- `@workspace/api-server`: the HTTP/API service. It should run the web-only API command.
- `review-worker`: the durable review worker service. It should run the worker-only command and should not have a public domain.

The web service serves the built React app and proxies `/api/*` requests to the API service through `API_PROXY_TARGET`.

The API service should use:

```bash
pnpm --filter @workspace/api-server run start:web
```

The review worker service should use:

```bash
pnpm --filter @workspace/api-server run start:worker
```

This split keeps login, exports, normal browsing, and upload/job creation isolated from long-running review work. If the worker is restarted or crashes while reviewing a paper, the API service should remain available and the durable job can be retried or recovered.

## Environment Split

Use separate Railway environments or separate Railway projects:

- Staging web URL: Railway-generated domain for staging `@workspace/scireview`.
- Production web URL: `https://modernscience.review`, attached only to production `@workspace/scireview`.
- Staging database: a staging Postgres database and staging `DATABASE_URL`.
- Production database: a production Postgres database and production `DATABASE_URL`.

Submissions made through staging are stored only in the staging database. Submissions made through production are stored only in the production database. Moving selected data between them should be an explicit export/import or migration task, not automatic sharing.

## Required Variables

Set these on both the `@workspace/api-server` and `review-worker` services:

- `DATABASE_URL`: environment-specific Postgres connection string.
- `AI_INTEGRATIONS_GEMINI_API_KEY`: Gemini API key.
- `AI_INTEGRATIONS_GEMINI_BASE_URL`: `https://generativelanguage.googleapis.com`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: `https://api.openai.com/v1`
- `AI_INTEGRATIONS_OPENAI_API_KEY`: optional, only needed for older OpenAI integration helpers.
- `OPENAI_API_KEY`: optional, only needed for OpenAI review mode or OpenAI-powered review chat replies.
- `GOOGLE_CLIENT_ID`: Google OAuth client id.
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret.
- `ISSUER_URL`: optional; defaults to `https://accounts.google.com`.
- `PUBLIC_WEB_ORIGIN`: the matching web origin for that environment.
- `ADMIN_EMAIL`: the Google account email that should get admin controls.

For the API service, set:

- `REVIEW_PROCESS_ROLE=web`
- `REVIEW_JOB_PROCESSING_ENABLED=false`

For the worker service, set:

- `REVIEW_PROCESS_ROLE=worker`
- `REVIEW_JOB_PROCESSING_ENABLED=true`

Set these on each `@workspace/scireview` service:

- `API_PROXY_TARGET`: internal or public URL for the matching environment's `@workspace/api-server`.
- `VITE_ADMIN_EMAIL`: same admin email used by the API.

## Google OAuth Redirects

Configure the Google OAuth client with redirect URIs for every web origin:

- `https://<staging-web-domain>/api/callback`
- `https://modernscience.review/api/callback`

The API computes callback URLs from `PUBLIC_WEB_ORIGIN`, so each environment's `PUBLIC_WEB_ORIGIN` must exactly match the site users browse.

## Database schema pushes (data-loss risk — flagged)

`start:with-db-push` runs `drizzle-kit push --force` on boot, which can auto-truncate tables to satisfy a schema change (it offered to truncate `calibration_pairs` during the v19 deploy). This is a destructive footgun on a data-bearing service.

- A guarded variant exists: `pnpm --filter @workspace/db run push-force-guarded`, which refuses unless `ALLOW_DESTRUCTIVE_DB_PUSH=true`. It is intentionally **not** wired into the deploy `start:with-db-push` command (doing so once broke a staging deploy by failing the guard on boot).
- Recommended: move schema changes to reviewed migrations (`drizzle-kit generate` + a `migrate` step), or have the deploy use `start` (no push) and run a guarded push as a separate, deliberate step. This change to the deploy command is left to the operator.

## Prompt Changes

The active review prompt lives in code in the API review engine. Change it in Git, deploy to staging, test, then deploy to production. There is intentionally no production admin button that mutates the active prompt at runtime.
