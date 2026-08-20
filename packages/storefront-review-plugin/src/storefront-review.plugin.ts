import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { StorefrontReview } from './entities/storefront-review.entity';
import { StorefrontReviewAdminResolver, StorefrontReviewShopResolver } from './storefront-review.resolver';
import { StorefrontReviewService } from './storefront-review.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StorefrontReview],
    providers: [StorefrontReviewService],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StorefrontReviewShopResolver],
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [StorefrontReviewAdminResolver],
    },
    compatibility: '^3.7.0',
})
export class StorefrontReviewPlugin {}
