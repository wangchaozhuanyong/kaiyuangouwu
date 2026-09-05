# Store Management Plugin

This local plugin provisions one merchant-owned storefront per Vendure Channel. It deliberately does not
enable multi-vendor order splitting or public seller registration.

## Provisioned resources

The SuperAdmin-only `provisionStore` Admin API mutation creates these resources in one transaction:

- one Seller;
- one Channel copied from a selected existing base Channel's language, currency, tax, shipping, and inventory defaults;
- one Channel-scoped merchant administrator Role;
- one Administrator with a server-generated temporary password;
- one password gate that restricts the merchant Admin API until the temporary password is changed;
- the selected base Channel's existing StockLocations assigned to the new Channel for shared inventory;
- one private `StoreProfile` for that store's customer-facing names, descriptions, logo, and status.

The generated Role excludes platform-level permissions such as creating or deleting Channels, Sellers,
Administrators, and Roles. Storefront content and custom-domain access use dedicated CRUD permissions.

Any existing Channel can be selected by a SuperAdmin as the base store. The
`isStoreProvisioningTemplate` flag protects a permanent base template from suspension and deprovisioning;
it is not required for copying configuration. The new store keeps its own merchant role and profile.

## Operational sequence

1. Provision the store from the Dashboard's `Provision store` page.
2. Deliver the one-time temporary password to the merchant through a secure channel.
3. Bind and verify the merchant domain on the new Channel.
4. Configure production shipping and payment methods.
5. Set the profile to `ACTIVE` after the primary domain is active.

## Independent storefront profiles

The `store_profile` table has a unique Channel relation and stores lifecycle status, management order,
bilingual descriptions, and an optional Vendure Asset logo. Existing Channels are backfilled as private
drafts by `AddStoreProfiles1786765800000`. The legacy publication column remains in the database for
migration compatibility, but no public store-directory Shop API is registered.

The SuperAdmin-only `storeProfiles` and `updateStoreProfile` Admin API operations power the Dashboard's
`Store management` page. Customer storefronts are reached only through their bound domains; this plugin
does not expose cross-store discovery or navigation.

Merchants use `myStoreProfile` and `updateMyStoreProfile`, which always resolve the active Channel and do
not accept another store's Channel or profile ID. The Dashboard also exposes a dedicated current-store
domain page backed by the Store Domain plugin's existing Channel isolation checks.

## Merchant catalog isolation

Provisioned merchant administrators are limited to exactly one active Channel. Vendure's Channel-aware
catalog queries and updates provide the primary isolation, while this plugin rejects cross-Channel
assignment/removal mutations and validates the parent Product and StockLocation IDs used when merchants
create or update variants. The merchant Dashboard keeps product, collection, asset, and stock-location
tools available while hiding platform Channel, shipping, payment, country, and zone administration.

## Merchant order isolation

Vendure's Order and Customer queries are filtered by the active Channel. Provisioned merchants may create
fulfillments for their own OrderLines, advance their own Fulfillments, and append order notes. The plugin
rejects payment, refund, cancellation, draft-order, order-modification, customer-reassignment, order-state,
and note-edit/delete mutations for merchants. The Dashboard keeps those platform operations visible only
to SuperAdmins while retaining merchant fulfillment and append-only note workflows.
