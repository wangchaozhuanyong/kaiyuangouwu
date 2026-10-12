# Legacy UI local build closure

All four assigned package builds passed. No tracked source, manifests, lockfiles, versions, budgets or assertions were changed.

| Package | Actual command | Exit | Duration | Receipt |
|---|---|---:|---:|---|
| admin-ui | bun run build in packages/admin-ui | 0 | 12.40 s | legacy-admin-ui-build-cache-corrected.json |
| ui-devkit | bun run build in packages/ui-devkit | 0 | 1.97 s | legacy-ui-devkit-build.json |
| dashboard | bun run build in packages/dashboard | 0 | 25.62 s | legacy-dashboard-build.json |
| graphiql-plugin | bun run build in packages/graphiql-plugin | 0 | 3.09 s | legacy-graphiql-plugin-build.json |

Frozen input: 3529 files; SHA-256 a2583efcbb5ed29d3b7d901de9058f92b4c5131fcd99c9fbebba8bc0a61d8f03. Node v24.19.0, Bun 1.3.14.

Build environment came from the public build-check step in .github/workflows/build_and_test.yml. All configurable temporary paths were redirected to this project ci-closure/runtime-staging; dotenv parsed no entries.

The first admin-ui library build exposed stale workspace ProseMirror cache pointers. Only 11 generated workspace symlinks with equal direct package versions and equal entry SHA-256 were removed, with each original restore target preserved in legacy-dependency-repair.json. The stale internal prosemirror-view 1.42.2 cache remains untouched; imports now resolve the already locked root canonical 1.42.3. Dashboard and GraphiQL passed independently and were not rerun; the dashboard 9 cache pointers remain intact.

Full output file hashes, byte totals, successful receipts, source/lock proofs and retained failures are in legacy-build-final.json.

This evidence covers local package builds only. Parent owns admin-ui-plugin app build, backend checks and the unified release; root owns any push, remote CI, deployment and production acceptance.
