import { LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { ProductEntityResolver } from './api/product-entity.resolver';
import { ProductReviewAdminResolver } from './api/product-review-admin.resolver';
import { ProductReviewEntityResolver } from './api/product-review-entity.resolver';
import { ProductReviewShopResolver } from './api/product-review-shop.resolver';
import { ProductReviewTranslation } from './entities/product-review-translation.entity';
import { ProductReview } from './entities/product-review.entity';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ProductReview, ProductReviewTranslation],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ProductEntityResolver, ProductReviewAdminResolver, ProductReviewEntityResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [ProductEntityResolver, ProductReviewShopResolver, ProductReviewEntityResolver],
    },
    configuration: config => {
        config.customFields.Product.push({
            name: 'reviews',
            type: 'relation',
            list: true,
            entity: ProductReview,
            inverseSide: (review: ProductReview) => review.product,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '关联商品评价' },
                { languageCode: LanguageCode.en, value: 'Linked product reviews' },
            ],
            description: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '选择要关联到当前商品的评价；也可以在此处新建评价。',
                },
                {
                    languageCode: LanguageCode.en,
                    value: 'Select reviews to link to this product, or create a new review here.',
                },
            ],
            ui: { component: 'review-multi-select-with-create' },
        });

        return config;
    },
    dashboard: './dashboard/index.tsx',
})
export class ReviewsPlugin {}
