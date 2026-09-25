import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Customer,
    CustomerService,
    Product,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import {
    CustomerProductActivity,
    CustomerProductActivityKind,
} from './entities/customer-product-activity.entity';

const FAVORITE_LIMIT = 100;
const HISTORY_LIMIT = 20;

export interface ActivityView {
    favoriteProductIds: string[];
    recentProductVisits: Array<{ productId: string; visitedAt: Date }>;
}

@Injectable()
export class CustomerProductActivityService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customers: CustomerService,
    ) {}

    async list(ctx: RequestContext): Promise<ActivityView> {
        const customer = await this.activeCustomer(ctx);
        return this.listForCustomer(ctx, customer.id);
    }

    async setFavorite(ctx: RequestContext, productId: ID, favorite: boolean): Promise<ActivityView> {
        const customer = await this.activeCustomer(ctx);
        const id = favorite ? await this.ownedProduct(ctx, productId) : this.normalizedProductId(productId);
        const repository = this.connection.getRepository(ctx, CustomerProductActivity);
        if (favorite) {
            const count = await repository.countBy({
                channelId: ctx.channelId,
                customerId: customer.id,
                kind: 'FAVORITE',
            });
            const existing = await repository.exist({
                where: { channelId: ctx.channelId, customerId: customer.id, kind: 'FAVORITE', productId: id },
            });
            if (!existing && count >= FAVORITE_LIMIT) throw new UserInputError('收藏数量已达上限');
            await repository.upsert(
                {
                    channelId: ctx.channelId,
                    customerId: customer.id,
                    productId: id,
                    kind: 'FAVORITE',
                    visitedAt: new Date(),
                },
                ['channelId', 'customerId', 'kind', 'productId'],
            );
        } else {
            await repository.delete({
                channelId: ctx.channelId,
                customerId: customer.id,
                kind: 'FAVORITE',
                productId: id,
            });
        }
        return this.listForCustomer(ctx, customer.id);
    }

    async removeFavorites(ctx: RequestContext, productIds: ID[]): Promise<ActivityView> {
        const customer = await this.activeCustomer(ctx);
        const ids = [...new Set(productIds.map(id => String(id).trim()).filter(Boolean))];
        if (ids.length > FAVORITE_LIMIT) throw new UserInputError('收藏数量无效');
        if (ids.length) {
            await this.connection.getRepository(ctx, CustomerProductActivity).delete({
                channelId: ctx.channelId,
                customerId: customer.id,
                kind: 'FAVORITE',
                productId: In(ids),
            });
        }
        return this.listForCustomer(ctx, customer.id);
    }

    async clear(ctx: RequestContext, kind: CustomerProductActivityKind): Promise<ActivityView> {
        const customer = await this.activeCustomer(ctx);
        await this.connection.getRepository(ctx, CustomerProductActivity).delete({
            channelId: ctx.channelId,
            customerId: customer.id,
            kind,
        });
        return this.listForCustomer(ctx, customer.id);
    }

    async recordVisit(ctx: RequestContext, productId: ID): Promise<ActivityView> {
        const customer = await this.activeCustomer(ctx);
        const id = await this.ownedProduct(ctx, productId);
        const repository = this.connection.getRepository(ctx, CustomerProductActivity);
        await repository.upsert(
            {
                channelId: ctx.channelId,
                customerId: customer.id,
                productId: id,
                kind: 'HISTORY',
                visitedAt: new Date(),
            },
            ['channelId', 'customerId', 'kind', 'productId'],
        );
        // MySQL requires a LIMIT when an OFFSET is used. Delete excess rows in
        // bounded batches so older histories are fully trimmed as well.
        let stale: CustomerProductActivity[];
        do {
            stale = await repository.find({
                select: ['id'],
                where: { channelId: ctx.channelId, customerId: customer.id, kind: 'HISTORY' },
                order: { visitedAt: 'DESC', id: 'DESC' },
                skip: HISTORY_LIMIT,
                take: HISTORY_LIMIT,
            });
            if (stale.length) await repository.delete({ id: In(stale.map(row => row.id)) });
        } while (stale.length === HISTORY_LIMIT);
        return this.listForCustomer(ctx, customer.id);
    }

    private async listForCustomer(ctx: RequestContext, customerId: Customer['id']): Promise<ActivityView> {
        const rows = await this.connection.getRepository(ctx, CustomerProductActivity).find({
            where: { channelId: ctx.channelId, customerId },
            order: { visitedAt: 'DESC', id: 'DESC' },
        });
        return {
            favoriteProductIds: rows.filter(row => row.kind === 'FAVORITE').map(row => String(row.productId)),
            recentProductVisits: rows
                .filter(row => row.kind === 'HISTORY')
                .map(row => ({ productId: String(row.productId), visitedAt: row.visitedAt })),
        };
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customers.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }

    private async ownedProduct(ctx: RequestContext, productId: ID): Promise<Product['id']> {
        const id = this.normalizedProductId(productId);
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id, channels: { id: ctx.channelId }, enabled: true },
        });
        if (!product) throw new UserInputError('商品不存在或不可用');
        return product.id;
    }

    private normalizedProductId(productId: ID): string {
        const id = String(productId).trim();
        if (!id || id.length > 80) throw new UserInputError('商品编号无效');
        return id;
    }
}
