# Classic graphite/champagne color preview

Serves the actual storefront production build with synthetic same-origin data. It does not connect to production or forward mutations. Product artwork is an existing local sample; this is not merchant-content acceptance.

From `packages/storefront`, build the app and run:

```sh
bun run build
node e2e/classic-palette/preview-server.mjs 57206
```

Open `/account`, `/referral`, `/coupons`, `/cart`, `/product?id=product-1`, or `/login`. Add `?skin=neo-minimalist` to a route to verify the unchanged alternate skin; add `?state=error` to `/coupons` to exercise the existing retry display. Language can be changed with the existing UI.

The palette is shared across stores. The approved change keeps page and card backgrounds, layout, content, geometry, assets, and business behavior. Only classic colors and existing control states change. Theme cache v3 ignores v2 palette colors while retaining the chosen skin.
