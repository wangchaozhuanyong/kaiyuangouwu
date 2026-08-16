import { Injectable } from '@nestjs/common';
import { ID, OrderLine, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

export interface StorefrontProductSales {
    productId: ID;
    quantity: number;
}

export const MAX_STOREFRONT_PRODUCT_SALES_IDS = 100;

@Injectable()
export class StorefrontProductSalesService {
    constructor(private readonly connection: TransactionalConnection) {}

    async findByProductIds(ctx: RequestContext, productIds: ID[]): Promise<StorefrontProductSales[]> {
        const uniqueProductIds = [...new Map(productIds.map(id => [String(id), id])).values()];
        if (!uniqueProductIds.length) return [];
        if (uniqueProductIds.length > MAX_STOREFRONT_PRODUCT_SALES_IDS) {
            throw new UserInputError(`一次最多查询 ${MAX_STOREFRONT_PRODUCT_SALES_IDS} 个商品的销量`);
        }

        const rows = await this.connection
            .getRepository(ctx, OrderLine)
            .createQueryBuilder('line')
            .innerJoin('line.order', 'order')
            .innerJoin('order.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoin('line.productVariant', 'variant')
            .innerJoin('variant.product', 'product')
            .select('product.id', 'productId')
            .addSelect('SUM(line.quantity)', 'quantity')
            .where('product.id IN (:...productIds)', { productIds: uniqueProductIds })
            .andWhere('order.orderPlacedAt IS NOT NULL')
            .andWhere('order.state != :cancelledState', { cancelledState: 'Cancelled' })
            .groupBy('product.id')
            .getRawMany<{ productId: string | number; quantity: string | number }>();
        const quantityByProductId = new Map(
            rows.map(row => [String(row.productId), Math.max(0, Number(row.quantity) || 0)]),
        );

        return uniqueProductIds.map(productId => ({
            productId,
            quantity: quantityByProductId.get(String(productId)) ?? 0,
        }));
    }
}
