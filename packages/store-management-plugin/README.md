# Store Management Plugin

This local plugin provisions one merchant-owned storefront per Vendure Channel. It deliberately does not
enable multi-vendor order splitting or public seller registration.

## Provisioned resources

The SuperAdmin-only `provisionStore` Admin API mutation creates these resources in one transaction:

- one Seller;
- one Channel copied from an existing template Channel's language, currency, tax, shipping, and inventory defaults;
- one Channel-scoped merchant administrator Role;
- one Administrator with a server-generated temporary password;
- one StockLocation assigned only to the new Channel.
- one unpublished `StoreProfile` used by the App store directory.

The generated Role excludes platform-level permissions such as creating or deleting Channels, Sellers,
Administrators, and Roles. Storefront content and custom-domain access use dedicated CRUD permissions.

## Operational sequence

1. Provision the store from the Dashboard's `Provision store` page.
2. Deliver the one-time temporary password to the merchant through a secure channel.
3. Bind and verify the merchant domain on the new Channel.
4. Configure production shipping and payment methods.
5. Set the profile to `ACTIVE` and publish it to the App directory after the primary domain is active.

## Store directory

The `store_profile` table has a unique Channel relation and stores lifecycle status, App visibility, sort
order, bilingual descriptions, and an optional Vendure Asset logo. Existing Channels are backfilled as
unpublished drafts by `AddStoreProfiles1786765800000`.

The public Shop API query `availableStores` returns only profiles that are `ACTIVE`, explicitly published,
and still have an active primary domain. The SuperAdmin-only `storeProfiles` and `updateStoreProfile` Admin
API operations power the Dashboard's `Store management` page.

A future forced-password-change flag still requires a separate approved schema change.
