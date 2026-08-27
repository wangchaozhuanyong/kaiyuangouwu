# Vendure Dev Server

This package is not published to npm. It is used in development of the Vendure server and plugins.

## Running

Start the Docker-backed services you need separately before starting the dev server. The development
command does not manage Docker, and all worktrees use the same configured database and other shared
services.

```bash
docker compose up -d postgres_16
```

The standard development command uses [Portless](https://portless.sh/) to give the API and Dashboard
stable URLs without reserving fixed ports:

```bash
cd packages/dev-server
DB=postgres bun run dev
```

The default database is MySQL, although most local development uses Postgres. The database can be
changed to `DB=mysql` or `DB=sqlite` when needed.

On its first run, Portless may ask to install and trust its local HTTPS certificate. If the Portless
proxy cannot start, `dev` fails with the Portless setup instructions rather than falling back to
fixed ports.

The main checkout uses:

- API: `https://vendure.localhost`
- Dashboard: `https://dashboard.vendure.localhost/dashboard/`

Linked worktrees are automatically prefixed with their branch name. A worktree for `fix-order-list`
uses:

- API: `https://fix-order-list.vendure.localhost`
- Dashboard: `https://fix-order-list.dashboard.vendure.localhost/dashboard/`

The Dashboard calls its matching worktree API directly. Browser sessions are isolated by the
worktree-specific API hostname, while Docker resources and database data remain shared.

Before starting any long-running process, `dev` builds the package entry points required by the API
and Dashboard Vite server. It then supervises:

- the Vendure API server;
- the Dashboard Vite development server;
- the `@vendure/common` and `@vendure/core` watchers;
- the Dashboard Vite-plugin and backend-plugin watchers.

Successful dependency rebuilds restart the process that loaded those compiled modules. Dashboard
application changes continue to use Vite HMR.

The workflow keeps the Dashboard backend plugin active for its API and settings features, but does
not build or serve a second static Dashboard. Use the Portless Dashboard URL above. It also skips
the standalone GraphiQL frontend. Running `dev:server` directly retains static Dashboard and
GraphiQL serving for workflows that have already built their frontend assets.

### Agent-driven development

Agents should use the status-aware launcher:

```bash
cd packages/dev-server
bun run dev:agent
```

This runs the same Portless workflow as `bun run dev` and writes its lifecycle state to the current
worktree's ignored `.vendure/dev-server.json` file. It also emits `VENDURE_DEV_EVENT=<json>` lines for
agents that retain the process output.

The lifecycle progresses through `building`, `starting`, and `ready`, with `failed` and `stopping`
events when applicable. `ready` is only published after all package watchers complete their initial
compilation and these endpoints respond successfully:

- the API health endpoint;
- the Dashboard Vite URL;

Watcher-triggered process restarts move the lifecycle back to `starting` until the restarted
endpoint is accepting requests again.

An agent can wait for readiness and discover every URL without parsing human-oriented logs:

```bash
bun run dev:status --wait --json
```

The output has this shape:

```json
{
    "status": "ready",
    "pid": 12345,
    "worktreePath": "/path/to/worktree",
    "apiUrl": "https://fix-order-list.vendure.localhost",
    "dashboardUrl": "https://fix-order-list.dashboard.vendure.localhost/dashboard/",
    "statusFile": "/path/to/worktree/.vendure/dev-server.json"
}
```

Failed or timed-out status responses also include an `error` field.

The default readiness timeout is 300 seconds. Override it when needed:

```bash
bun run dev:status --wait --json --timeout 600
```

Stop only the current worktree's agent-managed supervisor with:

```bash
bun run dev:stop
```

The supervisor removes its status file on shutdown. Status and startup commands automatically remove
stale files whose PID is no longer alive, and a second `dev:agent` invocation in the same worktree
fails with the active supervisor PID.

Agent rules:

- reuse shared Docker services and do not shut them down after an individual task;
- use `dev:agent`, not `dev:direct`, when worktrees may run in parallel;
- start `dev:worker` only when worker behavior is part of the test;
- stop only the current worktree's supervisor with `dev:stop`;
- treat the database as shared mutable state and prefer unique test data;
- do not populate, reset, or destructively migrate shared data without checking other active work.

### Worker

The worker is deliberately not started by `bun run dev`, because all worktrees share the same job
queue and database. Start it explicitly only when the work needs worker behavior:

```bash
bun run dev:worker
```

Only one worker may run for this repository. The command stores an advisory lock at
`<primary-repository-root>/.vendure/worker.lock`. If another worktree owns the lock, startup fails and
reports its path and PID. Locks whose process is no longer alive are reclaimed automatically.

### Fixed-port escape hatch

Use the direct workflow when debugging Portless itself or when named local URLs are unsuitable:

```bash
bun run dev:direct
```

This uses the traditional API port `3000` and Dashboard Vite port `5173`, so it is not safe to run
from multiple worktrees simultaneously.

### Manual worktree smoke test

1. Run `bun run dev` in the main checkout and a linked worktree.
2. Confirm both printed Dashboard URLs load and call their matching API hostname.
3. Change a file in `@vendure/core` and confirm that only that worktree's server restarts after the
   successful rebuild.
4. Change Dashboard application code and confirm HMR updates the matching Dashboard.
5. Start `bun run dev:worker` in one checkout and confirm a second checkout reports the lock owner.
6. Stop the first worker and confirm the second checkout can start it.

## Populating data

Test data can be populated by running the `populate` script. This uses the same sample data as is used by the Vendure CLI when running `init`, albeit with the additional step of populating some sample customer & address data too.

Specify the database as above to populate that database:

```bash
[DB=mysql|postgres|sqlite] bun run populate
```

## AI image studio

The custom image-generation plugin is registered in `dev-config.ts`. Its provider setup, model
pricing, referral-wallet settlement, private storage, prompt Skill workflow, production variables,
and launch checklist are documented in
[`../image-generation-plugin/README.md`](../image-generation-plugin/README.md).

## Publishing storefront media

The storefront redesign assets have one release manifest in
`scripts/sync-storefront-media.mjs`. The command uploads each changed file to the Vendure asset
library, assigns it to the configured Channel, and binds the same asset ID to product variants and
managed storefront content blocks. The Dashboard and Shop API therefore use the same asset; the
client does not replace backend image URLs by filename.

Validate the local manifest without contacting Vendure:

```bash
bun run sync:storefront-media -- --validate
```

Preview the exact assets and targets without writing:

```bash
bun run sync:storefront-media -- --dry-run
```

Apply to a local Vendure instance:

```bash
bun run sync:storefront-media -- --apply
```

For a production release, set `VENDURE_API_ORIGIN`, `SUPERADMIN_USERNAME`,
`SUPERADMIN_PASSWORD`, and `STOREFRONT_MEDIA_CHANNEL_CODES` in the release environment. If the
configured password has been rotated, provide an existing short-lived Admin API session through
`VENDURE_ADMIN_BEARER_TOKEN` instead. Then run
the sync after the API is healthy and before the new storefront is promoted:

```bash
bun run sync:storefront-media -- --apply --allow-remote
```

Remote writes require both flags. Existing asset records are not deleted: an unchanged file is
reused by its SHA-256 tag, while a changed file creates a new asset and moves the configured
bindings to it. This makes the command safe to repeat and keeps rollback assets available.

## Publishing login and registration visuals

Login and registration copy, tags, and palette use the separate reviewed manifest in
`scripts/sync-auth-visuals.mjs`. The publisher resolves `auth-login-visual` and
`auth-register-visual` by exact code and type, preserves their current image asset or image URL,
and verifies that the Admin API and Shop API return the same values in Chinese and English.

Preview the exact Channels, blocks, current image bindings, and planned field changes without
writing:

```bash
bun run sync:auth-visuals -- --dry-run
```

Apply locally, or use the additional remote-write guard in a reviewed production release:

```bash
bun run sync:auth-visuals -- --apply
bun run sync:auth-visuals -- --apply --allow-remote
```

Set `AUTH_VISUAL_CHANNEL_CODES` in the release environment when it differs from
`STOREFRONT_MEDIA_CHANNEL_CODES`. Authentication uses the same environment-only Admin API
credentials or short-lived `VENDURE_ADMIN_BEARER_TOKEN` as the media publisher. Repeating the
command is safe: blocks already matching the manifest are reported as `noop` and are not mutated.

## Repairing reviewed inventory inheritance targets

New product variants save `trackInventory=INHERIT`, but existing variants which already contain an
explicit `FALSE` are not changed automatically. For a reviewed one-time repair, set the exact
Channel codes and stable SKUs in environment variables. The command refuses missing or ambiguous
SKUs, leaves existing `INHERIT` values unchanged, and refuses to replace an explicit `TRUE` value.

```bash
INVENTORY_REPAIR_CHANNEL_CODES=__default_channel__ \
INVENTORY_INHERIT_SKUS=reviewed-sku-a,reviewed-sku-b \
bun run repair:inventory-inheritance -- --dry-run
```

After reviewing every returned variant ID, SKU, Channel and current value, apply locally with
`--apply`. Production or remote writes additionally require `--allow-remote`:

```bash
bun run repair:inventory-inheritance -- --apply --allow-remote
```

Credentials and targets are read only from environment variables; they are never accepted as CLI
arguments. If the configured password is not the active Dashboard credential, a short-lived
authenticated Admin API session may be supplied as `VENDURE_ADMIN_BEARER_TOKEN`. Never print or
persist that token. Unset all three repair variables after the one-time repair.

## Testing custom ui extension compilation

In order to compile ui extensions within this monorepo, you need to add the following entry to
the [temporary admin ui `tsconfig.json`](./custom-admin-ui/tsconfig.json) file:

```
  "paths": {
      "@vendure/admin-ui/*": ["../../admin-ui/package/*"]
  }
```

## Load testing

This package also contains scripts for load testing the Vendure server. The load testing infrastructure and scripts are located in the [`./load-testing`](./load-testing) directory.

Load testing is done with [k6](https://docs.k6.io/), and to run them you will need k6 installed and (in Windows) available in your PATH environment variable so that it can be run with the command `k6`.

The load tests assume the existence of the following tables in the database:

- `vendure-load-testing-1000`
- `vendure-load-testing-10000`
- `vendure-load-testing-100000`

The npm scripts `load-test:1k`, `load-test:10k` and `load-test:100k` will populate their respective databases with test data and then run the k6 scripts against them.

## Running individual scripts

An individual test script may be by specifying the script name as an argument:

```
bun run load-test:1k deep-query.js
```

## pg_stat_statements

The following queries can be used when running load tests against postgres to analyze the queries:

```sql
SELECT
  dbid,
  (total_time / 1000 / 60) as total,
  (total_time/calls) as avg,
  calls,
  query
FROM pg_stat_statements
WHERE dbid = <db_id>
ORDER BY total DESC
LIMIT 100;

-- SELECT pg_stat_statements_reset();
```

### Results

The results of the test are saved to the [`./load-testing/results`](./load-testing/results) directory. Each test run creates two files:

- `load-test-<date>-<product-count>.json` Contains a summary of all load tests run
- `load-test-<date>-<product-count>-<script-name>.csv` Contains time-series data which can be used to create charts

Historical benchmark results with charts can be found in [this Google Sheet](https://docs.google.com/spreadsheets/d/1UaNhmokbNmKDehrnh4m9XO6-DJte-AI-l_Lnji47Qn8/edit?usp=sharing)
