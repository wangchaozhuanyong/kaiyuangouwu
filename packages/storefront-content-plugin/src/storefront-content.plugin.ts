import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { storefrontContentPermission } from './constants';
import { StorefrontContentBlockTranslation } from './entities/storefront-content-block-translation.entity';
import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentItemTranslation } from './entities/storefront-content-item-translation.entity';
import { StorefrontContentItem } from './entities/storefront-content-item.entity';
import { StorefrontContentSettings } from './entities/storefront-content-settings.entity';
import { StorefrontContentAdminResolver, StorefrontContentShopResolver } from './storefront-content.resolver';
import { StorefrontContentService } from './storefront-content.service';
import { StorefrontExternalImageService } from './storefront-external-image.service';

@VendurePlugin({
    imports: [PluginCommonModule, ContentTranslationPlugin],
    entities: [
        StorefrontContentBlock,
        StorefrontContentBlockTranslation,
        StorefrontContentItem,
        StorefrontContentItemTranslation,
        StorefrontContentSettings,
    ],
    providers: [StorefrontContentService, StorefrontExternalImageService],
    configuration: config => {
        config.authOptions.customPermissions.push(storefrontContentPermission);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [StorefrontContentAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StorefrontContentShopResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StorefrontContentPlugin {}
