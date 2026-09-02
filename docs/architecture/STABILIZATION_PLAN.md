# Architecture stabilization plan

This repository is in stabilization mode. Refactoring work must reduce structural debt without changing
business behaviour, database meaning, public GraphQL contracts, or production release controls in the same
pull request.

## Current baseline

- Production integration baseline: `55c0a38f2489e910d4718b554d75c5e9eff3730b`.
- The largest active hotspots are recorded in `scripts/architecture-debt-baseline.json`.
- Existing hotspot limits are ceilings, not acceptable end states. A hotspot may shrink but must not grow.
- Applied migrations are immutable. Schema corrections use a new forward-only migration.
- Two historical source files are intentionally frozen outside the active migration registry because they
  collide with already registered timestamps: `1787785200000-align-usdt-trc20-schema.ts` and
  `1787796000000-normalize-digital-inventory.ts`. They must not be registered retroactively; removal or
  replacement requires a production migration-history and schema audit.
- The standalone `next-admin` application is the production UI, while legacy Dashboard extension sources
  remain until their parity and deprecation gates have been completed.

## Work streams

1. Split storefront CSS, application orchestration, and Shop API operations by feature.
2. Split oversized next-admin route modules into route containers, domain hooks, forms, and view components.
3. Split catalog import, image generation, referral, coupon, and payment services at transaction boundaries.
4. Prevent migration registry omissions, timestamp collisions, and schema drift across supported databases.
5. Retire duplicate legacy Dashboard surfaces only after usage and parity evidence exists.

Each refactor pull request must stay inside one work stream and include focused regression tests.

## Feature deprecation gate

A route, API, compatibility path, job, entity, or UI surface may be removed only when all of the following are
recorded in the pull request:

1. The replacement or business reason for removal.
2. At least 30 days of route, API, job, and relevant database usage evidence, or two complete release cycles.
3. Confirmation that no active merchant workflow or audit requirement depends on it.
4. A data export or retention decision for affected records.
5. A rollback plan and an observation period with the entry point disabled before deletion.

Removal must cover the complete vertical slice: navigation, routes, GraphQL schema, resolvers, services,
scheduled jobs, configuration, environment examples, translations, tests, documentation, and later—when the
retention period permits—a separate forward-only database migration.

## Required checks

```bash
bun run check:migration-registry
bun run check:architecture-debt
bun run test:repository-checks
```

Package-scoped lint, tests, builds, and relevant browser/database checks remain mandatory in addition to these
repository checks.
