import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api-extensions';
import { StorefrontCatalogShopResolver } from './storefront-catalog.resolver';
import { StorefrontCatalogService } from './storefront-catalog.service';
import { StorefrontProductSalesService } from './storefront-product-sales.service';
import { StorefrontRecommendationsService } from './storefront-recommendations.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [StorefrontCatalogService, StorefrontProductSalesService, StorefrontRecommendationsService],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StorefrontCatalogShopResolver],
    },
    compatibility: '^3.7.0',
})
export class StorefrontCatalogPlugin {}
