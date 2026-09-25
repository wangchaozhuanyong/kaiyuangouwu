import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Customer,
    CustomerService,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { StoreNotificationRead } from './entities/store-notification-read.entity';

export type StoreNotificationKind = 'ORDER' | 'AFTER_SALES';

export interface StoreNotificationReference {
    kind: StoreNotificationKind;
    sourceId: ID;
    version: string;
}

export function notificationEventKey(reference: StoreNotificationReference): string {
    const sourceId = String(reference.sourceId ?? '').trim();
    const version = String(reference.version ?? '').trim();
    const timestamp = Date.parse(version);
    if (
        !['ORDER', 'AFTER_SALES'].includes(reference.kind) ||
        !sourceId ||
        sourceId.length > 80 ||
        !Number.isFinite(timestamp) ||
        version.length > 40
    ) {
        throw new UserInputError('消息标识无效');
    }
    return `${reference.kind}:${sourceId}:${new Date(timestamp).toISOString()}`;
}

@Injectable()
export class StoreNotificationReadService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
    ) {}

    async readKeys(ctx: RequestContext, references: StoreNotificationReference[]): Promise<string[]> {
        const customer = await this.customer(ctx);
        const keys = this.keys(references);
        if (!keys.length) return [];
        const rows = await this.connection.getRepository(ctx, StoreNotificationRead).find({
            where: { channelId: ctx.channelId, customerId: customer.id, eventKey: In(keys) },
        });
        return rows.map(row => row.eventKey);
    }

    async markRead(ctx: RequestContext, references: StoreNotificationReference[]): Promise<string[]> {
        const customer = await this.customer(ctx);
        this.keys(references);
        const orders = references.filter(reference => reference.kind === 'ORDER');
        const afterSales = references.filter(reference => reference.kind === 'AFTER_SALES');
        const [ownedOrders, ownedRequests] = await Promise.all([
            orders.length
                ? this.connection.getRepository(ctx, Order).find({
                      where: {
                          id: In(orders.map(reference => reference.sourceId)),
                          customerId: customer.id,
                          salesChannelId: ctx.channelId,
                      },
                  })
                : [],
            afterSales.length
                ? this.connection.getRepository(ctx, AfterSalesRequest).find({
                      where: {
                          id: In(afterSales.map(reference => reference.sourceId)),
                          channelId: ctx.channelId,
                          customerId: customer.id,
                          order: { salesChannelId: ctx.channelId },
                      },
                  })
                : [],
        ]);
        const current = new Set([
            ...ownedOrders.map(order =>
                notificationEventKey({
                    kind: 'ORDER',
                    sourceId: order.id,
                    version: order.updatedAt.toISOString(),
                }),
            ),
            ...ownedRequests.map(request =>
                notificationEventKey({
                    kind: 'AFTER_SALES',
                    sourceId: request.id,
                    version: request.updatedAt.toISOString(),
                }),
            ),
        ]);
        const keys = [...new Set(references.map(notificationEventKey))].filter(key => current.has(key));
        if (!keys.length) return [];
        await this.connection
            .getRepository(ctx, StoreNotificationRead)
            .createQueryBuilder()
            .insert()
            .into(StoreNotificationRead)
            .values(
                keys.map(eventKey => ({
                    channelId: ctx.channelId,
                    customerId: customer.id,
                    eventKey,
                    readAt: new Date(),
                })),
            )
            .orIgnore()
            .updateEntity(false)
            .execute();
        return keys;
    }

    private keys(references: StoreNotificationReference[]): string[] {
        if (!Array.isArray(references) || references.length > 100)
            throw new UserInputError('一次最多处理 100 条消息');
        return [...new Set(references.map(notificationEventKey))];
    }

    private async customer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }
}
