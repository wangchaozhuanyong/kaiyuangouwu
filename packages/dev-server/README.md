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

If the Admin user can access multiple Channels, `STOREFRONT_MEDIA_CHANNEL_CODES` is mandatory. A
Channel is selected implicitly only when the account can access exactly one, so a publisher can
never silently fall back to an unrelated store.

Apply to a local Vendure instance:

```bash
bun run sync:storefront-media -- --apply
```

For a production release, set `VENDURE_API_ORIGIN`, `VENDURE_STOREFRONT_URL`,
`SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD`, and `STOREFRONT_MEDIA_CHANNEL_CODES` in the release
environment, then run the sync after the API is healthy and before the new storefront is promoted.
The Admin origin may point at the loopback candidate, but the Shop origin must be the reviewed public
store domain so domain-to-Channel routing is exercised:

```bash
bun run sync:storefront-media -- --apply --allow-remote
```

Re-run the hard, read-only Admin API and Shop API reconciliation when independent release evidence
is required:

```bash
bun run sync:storefront-media -- --verify
```

Remote writes require both flags. Existing asset records are not deleted: an unchanged file is
reused by its SHA-256 tag, while a changed file creates a new asset and moves the configured
bindings to it. Existing product and variant galleries are preserved. Apply does not return success
until the same Asset ID is visible on the Admin and Shop APIs; a verification failure restores the
previous product/content bindings. `asset-library` targets are Admin Channel assets by design and
are reported as such instead of claiming client parity.

Auth page copy, palette and tags use the separate atomic content publisher. It applies all reviewed
blocks in one version-checked Admin API batch and verifies both Shop API languages. Set explicit
`AUTH_VISUAL_CHANNEL_CODES` whenever the Admin user has more than one accessible Channel, and set
`VENDURE_STOREFRONT_URL` to the public domain for that reviewed Channel:

```bash
bun run sync:auth-visuals -- --dry-run
bun run sync:auth-visuals -- --apply --allow-remote
bun run sync:auth-visuals -- --verify
```

MOYAO AI 的品牌名、双语简介/口号、色板和三组 Logo 由 StoreProfile 品牌发布器管理，
不得只在客户端写死。生产发布必须固定主 Channel，依次执行预演、受保护写入和独立只读
验证：

```bash
bun run sync:moyao-brand -- --dry-run --channel-code __default_channel__
bun run sync:moyao-brand -- --apply --allow-remote --channel-code __default_channel__
bun run sync:moyao-brand -- --verify --channel-code __default_channel__
```

写入会同时校验 Admin StoreProfile 和中英文 Shop API。校验失败时发布器按写入后的版本号恢复
原名称、文案、色板和 Logo Asset ID，并复验恢复状态；独立 `--verify` 未通过不得切换客户端。

Run `bun run check:storefront-publishing` before review. It rejects unclassified storefront media,
direct managed-media imports outside the fallback registry, and hard-coded remote media URLs in
runtime client code.

## Repairing reviewed inventory inheritance targets

New product variants now save `trackInventory=INHERIT`, but existing variants which already contain
an explicit `FALSE` are not changed automatically. For a reviewed one-time repair, set the exact
Channel codes and stable SKUs in environment variables. The command refuses missing or ambiguous
SKUs, leaves existing `INHERIT` values unchanged, and refuses to replace an explicit `TRUE` value.

```bash
INVENTORY_REPAIR_CHANNEL_CODES=cn-mainland,my-malaysia \
INVENTORY_INHERIT_SKUS=reviewed-sku-a,reviewed-sku-b \
bun run repair:inventory-inheritance -- --dry-run
```

After reviewing every returned variant ID, SKU, Channel and current value, apply locally with
`--apply`. Production or remote writes additionally require `--allow-remote`:

```bash
bun run repair:inventory-inheritance -- --apply --allow-remote
```

Credentials and targets are read only from environment variables; they are never accepted as CLI
arguments. Unset `INVENTORY_REPAIR_CHANNEL_CODES` and `INVENTORY_INHERIT_SKUS` after the one-time
repair.

## Repairing reviewed SQLite foreign-key violations

The local SQLite repair is intentionally limited to orphan translation rows for product variants,
facets, facet values, product options and product option groups. It refuses any violation outside
that whitelist and never deletes products, variants, orders, customers or other parent records.

Review the exact row IDs without writing:

```bash
DB=sqlite bun run repair:sqlite-foreign-keys -- --dry-run
```

Apply the reviewed plan locally:

```bash
DB=sqlite bun run repair:sqlite-foreign-keys -- --apply
```

Apply mode creates an online backup under `local-backups/` before opening an immediate transaction,
then requires `PRAGMA foreign_key_check` to return zero. It refuses to run when
`NODE_ENV=production` and is safe to repeat after a successful repair.

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
