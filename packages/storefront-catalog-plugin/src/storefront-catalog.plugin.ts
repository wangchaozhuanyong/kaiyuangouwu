import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api-extensions';
import { StorefrontCatalogShopResolver } from './storefront-catalog.resolver';
import { StorefrontCatalogService } from './storefront-catalog.service';
import { StorefrontProductSalesService } from './storefront-product-sales.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [StorefrontCatalogService, StorefrontProductSalesService],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StorefrontCatalogShopResolver],
    },
    compatibility: '^3.7.0',
})
export class StorefrontCatalogPlugin {}
