# Vendure

Headless e-commerce framework. Lerna monorepo with fixed versioning.

## Development Workflow

1. Make changes to a package
2. Build it (or `bun run watch` for continuous)
3. Update `packages/dev-server/dev-config.ts` if needed
4. Restart dev server
5. Run e2e tests from the package dir

- When editing `@vendure/core`, you usually need to watch `@vendure/common` too: `bun run watch:core-common`
- The dev-server imports packages via TypeScript paths, so rebuilds are picked up on restart
- Switch DB with env var: `DB=postgres` or `DB=sqlite` before `bun run populate`

## Testing

- **E2E cache**: Seed data gets cached in `packages/<name>/e2e/__data__/`. **Delete to reset after schema changes.**

### Dashboard E2E Tests

When adding a new test, **always check existing suites first** before creating a new file:

- `catalog/product-list.spec.ts` — product list behaviour (sorting, column settings, filtering)
- `catalog/products.spec.ts` — product detail page
- `catalog/custom-fields.spec.ts` — custom field rendering, editing, persistence
- `sales/orders.spec.ts` — draft orders, order detail, order modification
- `tests/regression/` — **only** for tests that genuinely don't fit any existing suite

Add a comment referencing the issue number above the test, e.g.:
```ts
// #4393 — product list should default to sorting by updatedAt descending
test('should apply descending updatedAt sort by default', async ({ page }) => {
```

Run dashboard e2e tests from `packages/dashboard`:
```bash
CI=true VITE_TEST_PORT=5176 bunx playwright test --config e2e/playwright.config.ts <test-path> --reporter=list
```

## Commits & Branches

- Include `Fixes #ISSUE_NUMBER` in body, or `Relates to #ISSUE_NUMBER` if not a full fix
- `master` — bug fixes (default PR target)
- `minor` — new features
- `major` — breaking changes

## Gotchas

- **Dashboard stale build**: `packages/dev-server/dist/` accumulates stale Vite build artifacts across branch switches. Vite doesn't clean old hashed files, so old chunks can interfere (e.g. overwriting `window.schemaInfo`). Always `rm -rf packages/dev-server/dist` before rebuilding. Build with `bunx vite build --base /dashboard/ --outDir ../dev-server/dist` from `packages/dashboard/`. Also check no stale Vite dev server is running on port 5173 — `DashboardPlugin` auto-proxies to it instead of serving static files.

## Production Deployment

- Canonical runbook: `deploy/DEPLOYMENT_RUNBOOK.md`. Read it before every production release and update it when the topology changes.
- Production storefront: `https://damatong.net` (also `www.damatong.net`).
- Production dashboard: `https://console.damatong.net/dashboard/`.
- AWS region: `ap-northeast-1` (Tokyo); EC2 instance: `i-041a146558e432cbf`; security group: `sg-013cf38df187011ca`.
- Current public IPv4 snapshot: `52.196.65.143`; SSH user: `ubuntu`. No current-instance private key is configured locally; use the access procedure in the deployment runbook.
- Server repository: `/var/www/kaiyuangouwu`; branch: `main`; Vendure upstream: `127.0.0.1:3002`.
- PM2 processes: `vendure-api` and `vendure-worker`.
- Nginx storefront root: `/var/www/kaiyuangouwu/packages/storefront/dist`; the dashboard is served from `/var/www/kaiyuangouwu/packages/dev-server/dist/dashboard` by Vendure.
- Never commit the SSH private key or credentials. If port 22 is closed, temporarily allow only the current public CIDR in the production security group, deploy, verify, and remove that temporary rule immediately.
- Deploy only an isolated committed release. Build from a clean checkout of that commit, upload to a versioned candidate directory, verify checksums/health, atomically switch directories with a rollback directory, then confirm the public health endpoint and deployed Git SHA.
