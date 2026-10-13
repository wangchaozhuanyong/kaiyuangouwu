# Storefront refresh and navigation release candidate

This candidate contains the refresh/loading repair authorized in this conversation. Its base is `5db6ca46695440235b7232855fb77e65fbc779e0`; unrelated primary-worktree modifications are excluded.

Public category, product and direct search pages now preserve one responsive component tree from SSR through browser adoption. Critical styles reach the initial response, including the shared search layout and service/support resources. Published Router matches own visible data, copy and callbacks; Query owns prefetch results and cancellation. First empty boot may show the current scoped brand, while later transitions use page structure and recoverable errors.

Router timing remains pending 200ms/minimum 0ms. The change adds no dependency, API, database field or migration, and retains merchant content and existing authentication/payment rules. Direct desktop `/search` retains its results page; its header trigger focuses that page's input. Normal header search popovers remain available on other routes.

## Validation before push

- Existing targeted routing/query/brand/responsive/browser evidence was preserved. Four viewport widths cover initial adoption; continuous A→B→C navigation, filter/history, local cart identity, scope/language/currency and failure/retry scenarios passed.
- Release lint checked 53 changed source files with zero errors/warnings. Initial violations were repaired in the affected source/tests, without disabling rules.
- Post-repair affected storefront tests: 9 files/154 tests passed; category/product adoption and navigation/old-action browser checks: 10 scenarios passed against the rebuilt output.
- Scoped backend/dependency build: 23 projects passed. Storefront and Next Admin production builds passed with existing budgets. Next Admin's shared preview consumers passed 207 files/1575 tests.
- Store-management tests: 1533 passed/24 skipped; storefront-catalog: 27 passed. Remaining catalog, fulfillment, Admin-plugin and dev-server checks passed. Image-generation's missing generated CLI was built and its failed billing suite revalidated; prior passed suites were retained. Local worker failures were revalidated with bounded workers rather than altering assertions.
- Managed publishing and shared-storefront quality checks passed. No merchant-content publisher is selected for deployment.

The impact classifier selects runtime delivery because SSR HTML assembly is served by the store-management plugin. Frontend preview consumers are also included. `full=false`, with no database matrix or schema migration selected. Trusted CI, immutable Linux packaging, one exact-SHA Production Release and live browser checks are recorded in the local release ledger as they complete.

At preparation time all three public storefront manifests reported source `8ad884a9b4a403c7b4f8c60f445a7f2910e288d9`; each health endpoint returned `ok`. These are baseline observations, not acceptance of this candidate.
