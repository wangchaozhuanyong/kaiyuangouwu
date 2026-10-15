import {
    CatalogResourceOwnership,
    CatalogSyncBinding,
    CatalogSyncRule,
    CollectionFilter,
    LanguageCode,
    ProductVariant,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';

/** Stored configuration stays small even for categories with tens of thousands of variants. */
export const catalogSyncCollectionFilter = new CollectionFilter({
    code: 'catalog-sync-collection-filter',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '平台持续同步分类（由来源店铺管理）' },
        { languageCode: LanguageCode.en, value: 'Platform managed category supply' },
    ],
    args: {
        sourceCollectionId: { type: 'ID' },
        sourceChannelId: { type: 'ID' },
        targetChannelId: { type: 'ID' },
    },
    apply(qb, args) {
        const key = `sync_${randomUUID().replace(/-/g, '')}`;
        const sub = qb
            .subQuery()
            .select('1')
            .from(ProductVariant, 'syncVariant')
            .innerJoin('syncVariant.collections', 'syncCategory', `syncCategory.id = :${key}Collection`)
            .innerJoin('syncCategory.channels', 'sourceChannel', `sourceChannel.id = :${key}Source`)
            .innerJoin(
                CatalogSyncBinding,
                'syncBinding',
                `syncBinding.targetId = syncVariant.productId AND syncBinding.kind = 'PRODUCT' ` +
                    `AND syncBinding.state = 'ACTIVE' AND syncBinding.targetChannelId = :${key}Target ` +
                    `AND syncBinding.sourceChannelId = :${key}Source`,
            )
            .innerJoin(
                CatalogSyncRule,
                'syncRule',
                'syncRule.id = syncBinding.ruleId AND syncRule.enabled = :' + key + 'Enabled',
            )
            .innerJoin(
                CatalogResourceOwnership,
                'syncOwner',
                `syncOwner.resourceType = 'Product' AND syncOwner.resourceId = syncVariant.productId AND syncOwner.ownerChannelId = :${key}Source`,
            )
            .where('syncVariant.id = productVariant.id')
            .andWhere('syncVariant.deletedAt IS NULL');
        return qb.andWhere(`EXISTS ${sub.getQuery()}`, {
            [`${key}Collection`]: args.sourceCollectionId,
            [`${key}Source`]: args.sourceChannelId,
            [`${key}Target`]: args.targetChannelId,
            [`${key}Enabled`]: true,
        });
    },
});
