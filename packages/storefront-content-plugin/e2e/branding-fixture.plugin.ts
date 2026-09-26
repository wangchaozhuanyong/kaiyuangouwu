import { Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, PluginCommonModule, RequestContext, VendurePlugin } from '@vendure/core';
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

// Currency is an isolated commerce boundary; branding and saved content still use production resolvers.
@Resolver()
class BrowserCurrencyFixtureResolver {
    @Query()
    @Allow(Permission.Public)
    storefrontCurrencyConfiguration(@Ctx() ctx: RequestContext) {
        return {
            defaultCurrencyCode: ctx.channel.defaultCurrencyCode,
            availableCurrencyCodes: ctx.channel.availableCurrencyCodes,
            selectorEnabled: false,
            cnyToMyrRate: 1,
            rateUpdatedAt: null,
            usdtDisplayEnabled: false,
            usdtMarkupPercent: 0,
            cnyPerUsdtRate: null,
            myrPerUsdtRate: null,
            usdtRateSource: null,
            usdtRateUpdatedAt: null,
            usdtRateAvailable: false,
            usdtPaymentConfigured: false,
        };
    }
}

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
            type BrowserCurrencyConfiguration {
                defaultCurrencyCode: CurrencyCode!
                availableCurrencyCodes: [CurrencyCode!]!
                selectorEnabled: Boolean!
                cnyToMyrRate: Float!
                rateUpdatedAt: DateTime
                usdtDisplayEnabled: Boolean!
                usdtMarkupPercent: Float!
                cnyPerUsdtRate: Float
                myrPerUsdtRate: Float
                usdtRateSource: String
                usdtRateUpdatedAt: DateTime
                usdtRateAvailable: Boolean!
                usdtPaymentConfigured: Boolean!
            }
            extend type Query {
                storefrontBranding: StorefrontBranding!
                storefrontCurrencyConfiguration: BrowserCurrencyConfiguration!
            }
        `,
        resolvers: [StorefrontBrandingShopResolver, BrowserCurrencyFixtureResolver],
    },
})
export class BrandingFixturePlugin {}
