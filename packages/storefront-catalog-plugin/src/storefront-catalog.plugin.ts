import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { PUBLIC_CATALOG_READER } from '@vendure/store-management-plugin';

import { shopApiExtensions } from './api-extensions';
import { PublicCatalogReaderService } from './public-catalog-reader.service';
import { StorefrontCatalogShopResolver } from './storefront-catalog.resolver';
import { StorefrontCatalogService } from './storefront-catalog.service';
import { StorefrontProductSalesService } from './storefront-product-sales.service';
import { StorefrontRecommendationsService } from './storefront-recommendations.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        StorefrontCatalogService,
        StorefrontProductSalesService,
        StorefrontRecommendationsService,
        PublicCatalogReaderService,
        { provide: PUBLIC_CATALOG_READER, useExisting: PublicCatalogReaderService },
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StorefrontCatalogShopResolver],
    },
    compatibility: '^3.7.0',
})
export class StorefrontCatalogPlugin {}
