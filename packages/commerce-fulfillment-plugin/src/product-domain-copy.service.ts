import { Injectable } from '@nestjs/common';
import { CatalogOperationsService } from '@vendure/catalog-management-plugin';
import {
    ID,
    Product,
    ProductService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';

/** Copies presentation, options and prices. Every business resource starts empty. */
@Injectable()
export class ProductDomainCopyService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly products: ProductService,
        private readonly variants: ProductVariantService,
        private readonly catalog: CatalogOperationsService,
    ) {}

    async copy(ctx: RequestContext, productId: ID, fulfillmentType: string) {
        if (ctx.channel.code === '__default_channel__' || !['digital', 'physical'].includes(fulfillmentType))
            throw new UserInputError('请选择具体店铺与有效商品类型');
        const source = await this.connection.getEntityOrThrow(ctx, Product, productId, {
            channelId: ctx.channelId,
            relations: [
                'translations',
                'assets',
                'facetValues',
                'optionGroups',
                'variants',
                'variants.options',
                'variants.collections',
                'variants.collections.channels',
            ],
        });
        const collectionIds = [
            ...new Set(
                source.variants.flatMap(variant =>
                    variant.collections
                        .filter(collection =>
                            collection.channels.some(channel => String(channel.id) === String(ctx.channelId)),
                        )
                        .map(collection => collection.id),
                ),
            ),
        ];
        const suffix = randomUUID().slice(0, 8);
        const created = await this.products.create(ctx, {
            enabled: false,
            featuredAssetId: source.featuredAssetId,
            assetIds: source.assets.map(asset => asset.id),
            facetValueIds: source.facetValues.map(value => value.id),
            customFields: {
                fulfillmentType,
                refundPolicy: 'MERCHANT_REVIEW',
                manualDeliverySlaMinutes: 1440,
            },
            translations: source.translations.map(translation => ({
                languageCode: translation.languageCode,
                name: `${translation.name}（${fulfillmentType === 'digital' ? '数字' : '实物'}副本）`,
                slug: `${translation.slug}-${fulfillmentType}-${suffix}`,
                description: translation.description,
            })),
        });
        for (const group of source.optionGroups)
            await this.products.addOptionGroupToProduct(ctx, created.id, group.id);
        for (const original of source.variants.filter(variant => !variant.deletedAt)) {
            const priced = await this.variants.findOne(ctx, original.id, ['translations']);
            if (!priced) throw new UserInputError('原规格已变化，请刷新后重新复制');
            const [variant] = await this.variants.create(ctx, [
                {
                    productId: created.id,
                    sku: `COPY-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
                    price: priced.price,
                    enabled: original.enabled,
                    optionIds: original.options.map(option => option.id),
                    translations: priced.translations.map(translation => ({
                        languageCode: translation.languageCode,
                        name: translation.name,
                    })),
                },
            ]);
            await this.catalog.assignInitialCollections(ctx, created.id, variant.id, collectionIds);
            const cost = await this.catalog.latestCost(ctx, original.id, ctx.currencyCode);
            if (cost?.costMicrounits != null)
                await this.catalog.recordCost(
                    ctx,
                    variant.id,
                    ctx.currencyCode,
                    Number(cost.costMicrounits),
                    'MANUAL',
                    null,
                );
        }
        return created;
    }
}
