# next-admin backend host

This backend-only Vendure plugin hosts the application's `next-admin` build under `/dashboard/`.
It has no React Dashboard SDK dependency, Vite discovery, proxy fallback, or legacy UI extension registry.

`NextAdminPlugin.init({ route, appDir, serveStatic })` always registers the existing metrics and settings
API contract. `serveStatic: false` disables only file hosting; worker processes never host static files.

- Preserve `dashboardMetricSummary`, its `ReadOrder` permission and existing sales calculations.
- Preserve `DashboardGlobalViews` permissions and the `vendure.dashboard` settings namespace.
- Serve immutable hashed assets, return 404 for absent JS/CSS, and disable HTML caching.
- Return 503 when the configured next-admin build is unavailable.

Run `bun run build`, `bun run check-types`, and `bun run test` in this directory.
The application's approved old UI removal scope is recorded in
[the architecture record](../../docs/architecture/NEXT_ADMIN_ONLY_20260906.md).
