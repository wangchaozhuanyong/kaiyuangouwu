# Vendure

Headless e-commerce framework. Lerna monorepo with fixed versioning.

## Mandatory Task Preflight

- Read this `AGENTS.md` before starting every task in this repository. Do not rely on memory from an earlier task.
- Confirm the current project path, branch, package scope, package manager, relevant commands, and working-tree state before editing.

## CI Scope

- Unless the user explicitly requests it, do not start or wait for the full repository CI for ordinary fixes.
- For visual, CSS, copy, or isolated component changes, run only the affected frontend package's targeted checks and build. Do not run backend or database test matrices.
- For cross-package, core API, database migration, authentication, payment, or security changes, start with the smallest relevant checks and expand only when the actual impact or a failure requires it. Full CI is not the default.
- If GitHub starts full CI automatically, let it run in the background. Do not repeatedly poll or rerun it, and do not block an otherwise authorized merge or deployment solely because unrelated full-suite jobs are still running.
- Report any failed check that is relevant to the changed path. Never describe an unrun or still-running check as passed.

## Scoped Production Releases and Recovery

- Scope changes with `node scripts/ci-impact.mjs --base <base> --target <target>`; the CI and release workflows use the same classifier. Production compares the active backend SHA with the complete target tree, including every undeployed change.
- `Production Release` is the manual production entry. The legacy storefront entry delegates to it. Ordinary frontend changes use their package checks, verified static artifacts and independent pointers; shared inputs and backend changes use the runtime release. Explicit managed content writes retain their reviewed scope and backup requirements.
- Reuse checks only when the source tree and required file coverage match a successful trusted run. Reuse binaries only when their checksum, toolchain and build inputs also match. Missing artifacts may be rebuilt; missing relevant checks must run before deployment.
- A full CI run is opt-in for ordinary changes. Never create an empty commit, re-dispatch the same failed SHA, or repeatedly run all jobs to force a green result. Keep one fixed release run and preserve its successful stages.
- Within an authorized release, diagnose failures and continue fixing affected code instead of stopping at an error report. A code or configuration fix requires a new SHA and the affected checks. Repeat failures must lead to diagnosis, not another unchanged attempt.
- `node deploy/release-recovery.mjs report <run-id>` reports failed stages. Its `retry` command permits one failed-job retry only for a proven temporary infrastructure fault on the first attempt. Vulnerabilities, assertions, permissions, checksum errors and migration failures require repair. Exhausted retries stop the unchanged candidate; repair may continue within the existing authorization.
- Keep the last healthy version serving. Static deployment rolls back every switched frontend if acceptance fails. Runtime rollback retains its database compatibility restrictions; never force an incompatible rollback or delete production data to unblock a release.
- Finish only after the deployed component versions and affected functions are verified. Report local validation, GitHub checks, deployment, and browser/business acceptance separately.
- These rules apply to this repository and its stores. Do not change other projects or global GitHub/organization policies. Local implementation authorization does not authorize pushing, merging, deploying, or deleting branches/worktrees.

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
