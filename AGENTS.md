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
