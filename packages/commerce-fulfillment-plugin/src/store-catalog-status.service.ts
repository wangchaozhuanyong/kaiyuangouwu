import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Product,
    ProductSalesAuthorization,
    ProductService,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantService,
    RequestContext,
    StockLocation,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { AutoCardService } from './auto-card.service';
import { DigitalDeliveryTokenService } from './digital-delivery-token.service';

/** Operating metrics use the same authorization, price and delivery prerequisites as checkout. */
@Injectable()
export class StoreCatalogStatusService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly products: ProductService,
        private readonly variants: ProductVariantService,
        private readonly cards: AutoCardService,
        private readonly files: DigitalDeliveryTokenService,
    ) {}

    async summary(ctx: RequestContext) {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) throw new UserInputError('平台请使用商品分配中心');
        const products: Product[] = [];
        for (let skip = 0; ; skip += 100) {
            const page = await this.products.findAll(ctx, { skip, take: 100 }, ['translations']);
            products.push(...page.items);
            if (products.length >= page.totalItems || !page.items.length) break;
        }
        const grants = await this.connection
            .getRepository(ctx, ProductSalesAuthorization)
            .find({ where: { channelId: ctx.channelId } });
        const locations = await this.connection
            .getRepository(ctx, StockLocation)
            .count({ where: { channels: { id: ctx.channelId } } });
        const items = [];
        for (const product of products) {
            const grant = grants.find(g => String(g.productId) === String(product.id));
            const variants = (
                await this.connection.getRepository(ctx, ProductVariant).find({
                    where: {
                        productId: product.id,
                        channels: { id: ctx.channelId },
                        deletedAt: IsNull(),
                    },
                })
            ).filter(v => !grant || grant.variantIds.includes(String(v.id)));
            const prices = variants.length
                ? await this.connection.getRepository(ctx, ProductVariantPrice).find({
                      where: {
                          channelId: ctx.channelId,
                          currencyCode: ctx.channel.defaultCurrencyCode,
                          variant: { id: In(variants.map(v => v.id)) },
                      },
                      relations: ['variant'],
                  })
                : [];
            let configured = 0;
            let stocked = 0;
            for (const variant of variants.filter(v => v.enabled)) {
                if (
                    grant?.pendingVariantIds?.includes(String(variant.id)) ||
                    !prices.some(p => String(p.variant.id) === String(variant.id))
                )
                    continue;
                const fields = variant.customFields;
                if (fields.fulfillmentType === 'digital' && fields.digitalDeliveryMode === 'auto_card') {
                    const available = await this.cards.availableStockForVariant(ctx, variant.id);
                    if (available == null) continue;
                    configured++;
                    if (available > 0) stocked++;
                } else if (
                    fields.fulfillmentType === 'digital' &&
                    fields.digitalDeliveryMode === 'file_download'
                ) {
                    if (!this.files.resourceForSku(String(ctx.channelId), variant.sku)) continue;
                    configured++;
                    stocked++;
                } else if (fields.fulfillmentType === 'physical') {
                    if (!locations) continue;
                    configured++;
                    if ((await this.variants.getSaleableStockLevel(ctx, variant)) > 0) stocked++;
                } else {
                    // Manual delivery is prepared per selling-store order, never inherited from the supplier.
                    configured++;
                    stocked++;
                }
            }
            const paused = !product.enabled || grant?.state === 'PAUSED';
            const pending = !paused && (grant?.state === 'PENDING' || configured === 0);
            const listed = !paused && !pending;
            items.push({
                productId: String(product.id),
                listed,
                paused,
                pending,
                outOfStock: listed && stocked === 0,
                authorizedVariantCount: variants.length,
                configuredVariantCount: configured,
                pendingVariantCount: variants.filter(v => v.enabled).length - configured,
            });
        }
        return {
            channelId: String(ctx.channelId),
            scope: 'CURRENT_STORE_AUTHORIZED_PRODUCTS',
            authorized: items.length,
            listed: items.filter(i => i.listed).length,
            paused: items.filter(i => i.paused).length,
            pending: items.filter(i => !i.paused && (i.pending || i.pendingVariantCount > 0)).length,
            outOfStock: items.filter(i => i.outOfStock).length,
            items,
        };
    }
}
