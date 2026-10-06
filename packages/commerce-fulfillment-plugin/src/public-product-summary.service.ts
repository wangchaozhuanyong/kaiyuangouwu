import { Injectable } from '@nestjs/common';
import { SortOrder } from '@vendure/common/lib/generated-types';
import { projectProductDescription } from '@vendure/common/lib/product-description-summary';
import {
    Asset,
    AssetService,
    CollectionService,
    ConfigService,
    ListQueryOptions,
    LocaleStringHydrator,
    Product,
    ProductService,
    ProductVariantService,
    PublicProductDetail,
    PublicProductSummary,
    PublicProductSummaryReader,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { couponCollectionsForVariant } from '@vendure/store-management-plugin';

import {
    AutoCardShopProductVariantResolver,
    DigitalProductVariantMetadataResolver,
} from './auto-card.resolver';
import { AutoCardService } from './auto-card.service';
import { DigitalProductService } from './digital-product.service';
import { ProductPackagingService } from './product-packaging.service';

/** Anonymous storefront projection using the same stock, tax and coupon readers as GraphQL. */
@Injectable()
export class PublicProductSummaryService implements PublicProductSummaryReader {
    private readonly availability: AutoCardShopProductVariantResolver;
    private readonly metadata: DigitalProductVariantMetadataResolver;

    constructor(
        private readonly products: ProductService,
        private readonly variants: ProductVariantService,
        private readonly collections: CollectionService,
        private readonly cards: AutoCardService,
        digital: DigitalProductService,
        private readonly connection: TransactionalConnection,
        private readonly requestCache: RequestContextCacheService,
        private readonly config: ConfigService,
        private readonly assets: AssetService,
        private readonly packaging: ProductPackagingService,
        private readonly localeStrings: LocaleStringHydrator,
    ) {
        this.availability = new AutoCardShopProductVariantResolver(cards, variants, digital);
        this.metadata = new DigitalProductVariantMetadataResolver(digital);
    }

    async list(ctx: RequestContext, input: Parameters<PublicProductSummaryReader['list']>[1] = {}) {
        this.assertPublicContext(ctx);
        const take = input.take ?? 12;
        const skip = input.skip ?? 0;
        if (!Number.isInteger(take) || take < 1 || take > 100 || !Number.isInteger(skip) || skip < 0) {
            throw new UserInputError('公开商品列表分页无效');
        }
        const options: ListQueryOptions<Product> = {
            take,
            skip,
            sort: input.sort === 'newest' ? { createdAt: SortOrder.DESC } : { name: SortOrder.ASC },
            filter: {
                enabled: { eq: true },
                ...(input.term?.trim() ? { name: { contains: input.term.trim() } } : {}),
                ...(input.collectionId ? { collectionId: { eq: input.collectionId } } : {}),
            },
        };
        const page = await this.products.findAll(ctx, options, ['featuredAsset']);
        return { items: await this.project(ctx, page.items), totalItems: page.totalItems };
    }

    async byId(ctx: RequestContext, id: string) {
        this.assertPublicContext(ctx);
        const product = await this.products.findOne(ctx, id, ['featuredAsset']);
        return product?.enabled ? this.summary(ctx, product) : null;
    }

    async project(ctx: RequestContext, products: Product[]) {
        this.assertPublicContext(ctx);
        return Promise.all(
            products.filter(product => product.enabled).map(product => this.summary(ctx, product)),
        );
    }

    async detail(ctx: RequestContext, id: string): Promise<PublicProductDetail | null> {
        this.assertPublicContext(ctx);
        const product = await this.products.findOne(ctx, id, ['featuredAsset']);
        if (!product?.enabled) return null;
        const [summary, assets, packaging] = await Promise.all([
            this.summary(ctx, product),
            this.assets.getEntityAssets(ctx, product),
            this.packaging.configForProduct(ctx, product.id),
        ]);
        const variantProjection = async (variant: NonNullable<typeof packaging>['unitVariant']) => ({
            id: String(variant.id),
            name: await this.localeStrings.hydrateLocaleStringField(ctx, variant, 'name'),
            sku: variant.sku,
        });
        return {
            ...summary,
            description: product.description,
            assets: (assets ?? []).map(asset => this.asset(ctx, asset)),
            packaging: packaging
                ? {
                      id: String(packaging.id),
                      enabled: packaging.enabled,
                      autoUnpack: packaging.autoUnpack,
                      unitLabel: packaging.unitLabel,
                      packageLabel: packaging.packageLabel,
                      unitsPerPackage: packaging.unitsPerPackage,
                      unitVariant: await variantProjection(packaging.unitVariant),
                      packageVariant: await variantProjection(packaging.packageVariant),
                  }
                : null,
        };
    }

    private assertPublicContext(ctx: RequestContext) {
        if (ctx.apiType !== 'shop' || ctx.activeUserId || ctx.session) {
            throw new UserInputError('公开商品快照必须使用匿名商城上下文');
        }
    }

    private asset(ctx: RequestContext, asset: Asset): NonNullable<PublicProductSummary['featuredAsset']>;
    private asset(ctx: RequestContext, asset?: Asset | null): PublicProductSummary['featuredAsset'];
    private asset(ctx: RequestContext, asset?: Asset | null) {
        if (!asset) return null;
        const storage = this.config.assetOptions.assetStorageStrategy;
        return {
            id: String(asset.id),
            preview:
                storage.toAbsoluteUrl && ctx.req
                    ? storage.toAbsoluteUrl(ctx.req, asset.preview)
                    : asset.preview,
        };
    }

    private async summary(ctx: RequestContext, product: Product): Promise<PublicProductSummary> {
        const [variants, collections] = await Promise.all([
            this.variants.getVariantsForProduct(ctx, product.id, ['featuredAsset']),
            this.collections.getCollectionsByProductId(ctx, product.id, true),
        ]);
        const featuredAsset = this.asset(ctx, product.featuredAsset);
        return {
            id: String(product.id),
            createdAt: product.createdAt.toISOString(),
            name: product.name,
            slug: product.slug,
            ...projectProductDescription(product.description, product.name),
            featuredAsset,
            collections: collections.map(collection => ({
                id: String(collection.id),
                name: collection.name,
                slug: collection.slug,
                parentId: String(collection.parentId),
            })),
            customFields: {
                fulfillmentType: product.customFields.fulfillmentType,
                pricingMode: product.customFields.pricingMode ?? null,
                refundPolicy: product.customFields.refundPolicy,
                manualDeliverySlaMinutes: product.customFields.manualDeliverySlaMinutes,
            },
            variants: await Promise.all(
                variants.map(async variant => {
                    const [
                        saleableStockLevel,
                        autoCardAvailableStock,
                        fields,
                        storeCouponCollectionIds,
                        priceWithTax,
                        currencyCode,
                    ] = await Promise.all([
                        this.availability.saleableStockLevel(ctx, variant),
                        this.cards.availableStockForDisplay(ctx, variant),
                        this.metadata.customFields(ctx, variant),
                        couponCollectionsForVariant(ctx, variant.id, this.connection, this.requestCache),
                        this.variants.hydratePriceFields(ctx, variant, 'priceWithTax'),
                        this.variants.hydratePriceFields(ctx, variant, 'currencyCode'),
                    ]);
                    return {
                        id: String(variant.id),
                        name: variant.name,
                        sku: variant.sku,
                        priceWithTax,
                        currencyCode,
                        saleableStockLevel,
                        autoCardAvailableStock,
                        storeCouponCollectionIds,
                        featuredAsset: this.asset(ctx, variant.featuredAsset),
                        product: { id: String(product.id), name: product.name, featuredAsset },
                        customFields: {
                            fulfillmentType: fields.fulfillmentType,
                            digitalDeliveryMode: fields.digitalDeliveryMode ?? null,
                            digitalStockPolicy: fields.digitalStockPolicy ?? null,
                        },
                    };
                }),
            ),
        };
    }
}
