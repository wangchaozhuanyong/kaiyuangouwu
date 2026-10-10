This is a local synthetic anonymous SSR and hydration acceptance fixture. All store, product,
article, source and reviewer data are synthetic. It does not call a real backend or prove indexing,
deployment, sales or editorial review.

Run the storefront's authorized production build first. Then run `node e2e/seo-public/verify.mjs`
from `packages/storefront`. The harness loads `dist/.server/public-page-renderer.cjs` and serves the
matching actual `dist/index.html` and browser bundles. It mocks business API responses only; it
uses the real shared page components, `hydrateRoot`, router and regular interactive runtime.

Two synthetic hosts, two URL languages and home/product/catalog page 2/article routes are checked.
The browser locale intentionally differs from the URL language. HTML, screenshots and the scoped
request report are written only to `e2e/seo-public/artifacts/`. The HTML shell assembly here is a
fixture; server controller/SEO head assembly are covered by their own unit tests.
