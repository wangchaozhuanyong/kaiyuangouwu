# Storefront Cart Plugin

This local Vendure plugin owns the persistent storefront cart model used for partial cart checkout.
The cart keeps all pending items, while its selected lines are projected into the Vendure active Order.

It provides Shop API cart mutations with optimistic revisions, selected-line projection into the active
Order, checkout snapshots, payment-completion cleanup, scheduled reconciliation and guest-to-customer
cart merging.

The database schema is created by
`packages/dev-server/migrations/1786517100000-add-storefront-cart.ts`. The plugin is registered in the
development server config and its public operations are consumed by `packages/storefront`.
