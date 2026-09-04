# Vendure

Headless e-commerce framework. Lerna monorepo with fixed versioning.

## Mandatory Task Preflight

- Read this `AGENTS.md` before starting every task in this repository. Do not rely on memory from an earlier task.
- Confirm the current project path, branch, package scope, package manager, relevant commands, and working-tree state before editing.
- When a task touches a production release, also read `deploy/DEPLOYMENT_RUNBOOK.md` before changing code or running release commands.

## Storefront Data Publishing & Admin/Client Sync

- Vendure is the single source of truth for runtime-managed storefront data. Product images, product/variant featured assets, asset galleries, categories, Channels, storefront content blocks, login/register visuals, page copy, theme values, and other Dashboard-managed content must be stored in Vendure and read by the client through the Shop API.
- Publish these changes with a repository-owned release script that calls the Vendure Admin API. Manual Dashboard publishing may be used only for an explicitly requested one-off operation; it must not be the only undocumented release path.
- The standard media publisher is `packages/dev-server/scripts/sync-storefront-media.mjs`. Extend its manifest or create an equally reviewed, tested, idempotent Admin API publisher when another managed data type is introduced.
- Never simulate synchronization with client-only filename matching, hidden URL replacement maps, hard-coded asset overrides, or duplicated managed content. Bundled client assets are allowed only as explicit empty-state or unavailable-backend fallbacks.
- `bun run check:storefront-publishing` is a required repository gate. All managed storefront/brand media must be classified by an Admin API publisher, the central `packages/storefront/src/storefront-images.ts` fallback registry, or the explicit design-only inventory. Runtime components must not import managed media directly or hard-code remote media URLs.
- Every Admin API publisher must:
  - default to read-only validation or `--dry-run`, with writes requiring an explicit `--apply` flag;
  - require an additional explicit production/remote-write guard such as `--allow-remote`;
  - read credentials and target Channels from environment variables, never command arguments, source files, or logs;
  - resolve products by stable SKU and managed content by stable code/type, and fail before writes when a target is missing or ambiguous;
  - upload assets with deterministic logical tags plus a content hash, reuse unchanged assets, and remain safe to repeat;
  - bind the same Vendure asset IDs/settings to the Dashboard-managed entity consumed by the Shop API;
  - preserve existing asset galleries, use optimistic `expectedUpdatedAt` versions for managed content, and batch related content changes atomically where the API supports it;
  - hard-verify the written values through both Admin API and Shop API before returning success, and restore the previous bindings if post-write verification fails;
  - avoid deleting historical assets or user data during a normal publish so rollback remains possible;
  - report a reviewable summary of planned/applied targets without exposing secrets.
- Production release order is mandatory: start the candidate API, wait for health, run the publisher in dry-run mode, review exact Channel/SKU/content targets, run `--apply --allow-remote`, run the publisher's read-only verification mode, verify Admin API/Dashboard and Shop API/client resolve the same asset IDs and values, and only then promote the storefront candidate. A sync or verification failure stops the release.
- When a release introduces or changes the production guard for a managed publisher, deploy that guard/bootstrap in a separate first release before releasing the guarded publisher or managed data. The second release must use the new reviewed scope and verification path; never bypass the currently deployed guard to combine both stages.
- Pure presentation changes such as CSS spacing may ship with the client build. If the value is editable or represents catalog/content data, it belongs in Vendure and must use the Admin API publishing path above.
- Any task that changes managed storefront data or its publisher must update relevant manifests/config examples/runbook instructions and run publisher tests, storefront tests, and the relevant production build checks.

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

## Commits, Pull Requests & Branches

- `main` is the only integration and release branch for this repository. Never push directly to `main`.
- Start each task from the latest `origin/main` in a dedicated branch and, when the current workspace is dirty, a dedicated worktree.
- Run the package-scoped lint, tests and build before pushing. Use the full repository checks only when the change crosses package boundaries.
- Push the task branch, open a PR targeting `main`, and merge only after the required `all-passed` CI check succeeds.
- No human approval is required for owner-maintained PRs, but the PR and CI gate are still mandatory so every merge remains reviewable and reproducible.
- GitHub automatic branch deletion must remain disabled. For production-bound work, delete merged remote task branches only through the protected post-release cleanup workflow after deployment and acceptance evidence passes; remove the local task branch and temporary worktree after remote cleanup.
- CI validates code only. It must not deploy from pull requests or ordinary pushes. Production builds and deployments remain explicit, separate operations governed by `deploy/DEPLOYMENT_RUNBOOK.md`.
- This owner-maintained repository does not use the inherited Vendure CLA assistant, SonarQube scan, Vercel PR preview, or upstream PR-title gate.
- Use a clear Conventional Commit-style PR title when practical, without making title formatting a merge blocker.

### Mandatory Production Branch & Release Evidence Policy

- Production-bound changes must first be merged into `main` as an intentional, reviewed diff. Before merging, update the source branch against the latest `origin/main` and inspect both the complete diff and changed-file list. Never merge or commit an old workspace, release directory, WIP snapshot, or historical branch wholesale.
- Production may deploy only an exact 40-character commit currently reachable from `origin/main`, or an immutable formal release tag that resolves to such a commit. Never deploy an uncommitted workspace, feature branch, stale worktree, movable tag, or manually selected `dist` directory.
- Do not force-push `main` or move/reuse a formal release tag. If `origin/main` changes after validation, stop, update the release candidate, and repeat the checks and build.
- Delete merged feature, hotfix and release branches only after the exact production SHA, deployment run and manual acceptance run are verified. Use `.github/workflows/cleanup_merged_production_branches.yml` in dry-run mode first, then rerun with `apply=true`; the workflow preserves open, unmerged, backup, archive and artifact branches. Production releases must use the immutable `main` SHA or a formal release tag rather than retaining task branches. Keep an active maintenance branch or rollback tag only when its owner and purpose are documented.
- Every production deployment record must include the source branch, production ref (`main` or formal tag), full commit SHA, formal release tag when used, CI artifact name, artifact SHA-256 (or immutable container image digest), artifact workflow run, deployment workflow run, environment, UTC deployment time, operator, previous production SHA, and verification result. A mutable image version or tag alone is not sufficient evidence.
- Roll back only to a previously verified immutable artifact and record the rollback reason and SHA. Do not rewind `main`, rebuild from an old branch, or copy old build output over the active runtime.
- Missing branch ancestry, immutable artifact identity, deployment evidence, or post-deploy verification is a release blocker. Do not bypass it with a manual copy or direct server build.

## Gotchas

- **Dashboard stale build**: production serves the standalone app from `packages/next-admin/dist` under `/dashboard/`. Always start release builds with clean `packages/next-admin/dist` and `packages/dev-server/dist` directories, and run the next-admin production build verifier. Also check no stale Vite dev server is running on port 5173 — `DashboardPlugin` auto-proxies to it instead of serving static files.

## Production Deployment

- Canonical runbook: `deploy/DEPLOYMENT_RUNBOOK.md`. Read it before every production release and update it when the topology changes.
- Production storefronts: MOYAO AI at `https://moyaoai.com`; Meiyijia at `https://damatong.net`.
- Production dashboard: `https://console.moyaoai.com/dashboard/`; the legacy console domain redirects here.
- AWS region: `ap-northeast-1` (Tokyo); EC2 instance: `i-041a146558e432cbf`; security group: `sg-013cf38df187011ca`.
- Current public IPv4 snapshot: `52.196.65.143`; SSH user: `ubuntu`. The production SSH private key is stored outside the repository at `/Users/wangchao/Desktop/yamaxunmiyao2/yunqiao-vendure-prod-key.pem`; use this exact path with `-i` and `-o IdentitiesOnly=yes` for production SSH/rsync access unless the instance or key is explicitly replaced.
- Server repository: `/var/www/kaiyuangouwu`; branch: `main`; Vendure upstream: `127.0.0.1:3002`.
- PM2 processes: `vendure-api` and `vendure-worker`.
- Nginx storefront root: `/var/www/kaiyuangouwu-current/packages/storefront/dist`; the dashboard is served from `/var/www/kaiyuangouwu-current/packages/next-admin/dist` by Vendure. The stable pointer must reference a verified immutable release under `/var/www/kaiyuangouwu-releases`.
- Never read, print, copy into the repository, upload, or commit the SSH private key or credentials. Reference the external key by path only. If port 22 is closed, temporarily allow only the current public CIDR in the production security group, deploy, verify, and remove that temporary rule immediately.
- Deploy only an isolated committed release. Build from a clean checkout of that commit, upload to a versioned candidate directory, verify checksums/health, atomically switch directories with a rollback directory, then confirm the public health endpoint and deployed Git SHA.
