import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { Permission, PluginCommonModule, SettingsStoreScopes, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { StorefrontReview } from './entities/storefront-review.entity';
import {
    STOREFRONT_REVIEW_SETTINGS_NAMESPACE,
    StorefrontReviewSettingsService,
} from './storefront-review-settings.service';
import { StorefrontReviewAdminResolver, StorefrontReviewShopResolver } from './storefront-review.resolver';
import { StorefrontReviewService } from './storefront-review.service';

@VendurePlugin({
    imports: [PluginCommonModule, ContentTranslationPlugin],
    entities: [StorefrontReview],
    providers: [StorefrontReviewService, StorefrontReviewSettingsService],
    configuration: config => {
        config.settingsStoreFields ??= {};
        config.settingsStoreFields[STOREFRONT_REVIEW_SETTINGS_NAMESPACE] = [
            ...(config.settingsStoreFields[STOREFRONT_REVIEW_SETTINGS_NAMESPACE] ?? []),
            {
                name: 'enabled',
                scope: SettingsStoreScopes.channel,
                requiresPermission: { read: Permission.ReadCatalog, write: Permission.UpdateCatalog },
                validate: (value: unknown) =>
                    typeof value === 'boolean' ? undefined : 'Value must be a boolean',
            },
        ];
        return config;
    },
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
