import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import {
    StorefrontBrandingAdminResolver,
    StorefrontBrandingShopResolver,
} from '../../store-management-plugin/src/storefront-branding.resolver';
import {
    storefrontBrandingSchema,
    storefrontPreviewBrandingSchema,
} from '../../store-management-plugin/src/storefront-branding.schema';

// Register the production branding resolvers against the isolated test database.
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreProfile],
    adminApiExtensions: {
        schema: storefrontPreviewBrandingSchema,
        resolvers: [StorefrontBrandingAdminResolver],
    },
    shopApiExtensions: {
        schema: gql`
            ${storefrontBrandingSchema}
            extend type Query {
                storefrontBranding: StorefrontBranding!
            }
        `,
        resolvers: [StorefrontBrandingShopResolver],
    },
})
export class BrandingFixturePlugin {}
