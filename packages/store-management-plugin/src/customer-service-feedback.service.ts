import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { CustomerServiceFeedback } from './entities/customer-service-feedback.entity';

const feedbackTags = new Set(['FAST_RESPONSE', 'FRIENDLY', 'PROFESSIONAL', 'RESOLVED', 'EFFICIENT']);

export interface SubmitCustomerServiceFeedbackInput {
    orderCode?: string | null;
    rating: number;
    tags: string[];
    comment?: string | null;
}

export interface CustomerServiceFeedbackView extends CustomerServiceFeedback {
    tags: string[];
}

@Injectable()
export class CustomerServiceFeedbackService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customers: CustomerService,
    ) {}

    async myFeedback(
        ctx: RequestContext,
        orderCode?: string | null,
    ): Promise<CustomerServiceFeedbackView | null> {
        const customer = await this.activeCustomer(ctx);
        const order = await this.ownedOrder(ctx, customer, orderCode);
        const record = await this.connection.getRepository(ctx, CustomerServiceFeedback).findOneBy({
            channelId: ctx.channelId,
            customerId: customer.id,
            scopeKey: order ? `order:${order.id}` : 'general',
        });
        return record ? this.view(record) : null;
    }

    async submit(
        ctx: RequestContext,
        input: SubmitCustomerServiceFeedbackInput,
    ): Promise<CustomerServiceFeedbackView> {
        const customer = await this.activeCustomer(ctx);
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
            throw new UserInputError('客服评分必须为 1 至 5 星');
        }
        if (!Array.isArray(input.tags) || input.tags.length > feedbackTags.size) {
            throw new UserInputError('客服评价标签无效');
        }
        const tags = [...new Set(input.tags)];
        if (tags.some(tag => !feedbackTags.has(tag))) {
            throw new UserInputError('客服评价标签无效');
        }
        const comment = input.comment?.trim() || null;
        if (comment && comment.length > 1000) {
            throw new UserInputError('客服评价内容不能超过 1000 字');
        }
        const order = await this.ownedOrder(ctx, customer, input.orderCode);
        const scopeKey = order ? `order:${order.id}` : 'general';
        const repository = this.connection.getRepository(ctx, CustomerServiceFeedback);
        await repository.upsert(
            {
                channelId: ctx.channelId,
                customerId: customer.id,
                orderId: order?.id ?? null,
                orderCode: order?.code ?? null,
                scopeKey,
                rating: input.rating,
                tagsJson: JSON.stringify(tags),
                comment,
            },
            ['channelId', 'customerId', 'scopeKey'],
        );
        const saved = await repository.findOneByOrFail({
            channelId: ctx.channelId,
            customerId: customer.id,
            scopeKey,
        });
        return this.view(saved);
    }

    async list(
        ctx: RequestContext,
        skip = 0,
        take = 50,
    ): Promise<{ items: CustomerServiceFeedbackView[]; totalItems: number }> {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, CustomerServiceFeedback)
            .findAndCount({
                where: { channelId: ctx.channelId },
                order: { updatedAt: 'DESC', id: 'DESC' },
                skip: Math.max(0, Math.min(10_000, Math.trunc(skip))),
                take: Math.max(1, Math.min(100, Math.trunc(take))),
            });
        return { items: items.map(item => this.view(item)), totalItems };
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customers.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }

    private async ownedOrder(
        ctx: RequestContext,
        customer: Customer,
        value?: string | null,
    ): Promise<Order | null> {
        const code = value?.trim();
        if (!code) return null;
        if (code.length > 80) throw new UserInputError('订单编号无效');
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { code, customer: { id: customer.id }, channels: { id: ctx.channelId } },
        });
        if (!order) throw new UserInputError('订单不存在或不可评价');
        return order;
    }

    private view(record: CustomerServiceFeedback): CustomerServiceFeedbackView {
        let tags: string[] = [];
        try {
            const parsed: unknown = JSON.parse(record.tagsJson);
            if (Array.isArray(parsed)) tags = parsed.filter(tag => typeof tag === 'string');
        } catch {
            // Older malformed rows must not break the review list.
        }
        return Object.assign(record, { tags });
    }
}
