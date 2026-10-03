import { Injectable, Optional } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationService, NotificationSignalService } from '@vendure/operations-dashboard-plugin';
import { createHash } from 'node:crypto';

import { CustomerServiceFeedback } from './entities/customer-service-feedback.entity';

export const feedbackTagLabels: Record<string, string> = {
    FAST_RESPONSE: '响应迅速',
    FRIENDLY: '态度热情',
    PROFESSIONAL: '耐心专业',
    RESOLVED: '问题已解决',
    EFFICIENT: '处理高效',
};
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
        @Optional() private readonly notifications?: AdminNotificationService,
        @Optional() private readonly signals?: NotificationSignalService,
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
        const previous = await repository.findOneBy({
            channelId: ctx.channelId,
            customerId: customer.id,
            scopeKey,
        });
        if (
            previous &&
            previous.rating === input.rating &&
            previous.tagsJson === JSON.stringify(tags) &&
            previous.comment === comment
        )
            return this.view(previous);
        if (previous && Date.now() - previous.updatedAt.getTime() < 60_000)
            throw new UserInputError('评价修改过于频繁，请稍后重试');
        if (this.signals) {
            const key = createHash('sha256')
                .update(JSON.stringify(['feedback-rate', String(ctx.channelId), String(customer.id)]))
                .digest('hex');
            if ((await this.signals.count(key)).count > 10)
                throw new UserInputError('评价提交过于频繁，请稍后再试');
        }
        const values = {
            channelId: ctx.channelId,
            customerId: customer.id,
            orderId: order?.id ?? null,
            orderCode: order?.code ?? null,
            scopeKey,
            rating: input.rating,
            tagsJson: JSON.stringify(tags),
            comment,
            notificationRevision: (previous?.notificationRevision ?? 0) + 1,
        };
        if (previous) {
            const changed = await repository.update(
                { id: previous.id, notificationRevision: previous.notificationRevision },
                values,
            );
            if (changed.affected !== 1) throw new UserInputError('评价已变化，请刷新后重试');
        } else {
            await repository.createQueryBuilder().insert().values(values).orIgnore().execute();
        }
        const saved = await repository.findOneByOrFail({
            channelId: ctx.channelId,
            customerId: customer.id,
            scopeKey,
        });
        if (
            saved.rating !== values.rating ||
            saved.tagsJson !== values.tagsJson ||
            saved.comment !== values.comment
        )
            throw new UserInputError('评价已变化，请刷新后重试');
        if (this.notifications) {
            const version = saved.notificationRevision;
            await this.notifications.enqueueOneOff(
                ctx,
                {
                    eventType:
                        saved.rating <= 2
                            ? 'commerce.service_review.negative'
                            : 'commerce.service_review.submitted',
                    category: 'SERVICE_REVIEW',
                    severity: saved.rating <= 2 ? 'P1' : 'P3',
                    dedupKey: `service-feedback:${saved.id}:${version}`,
                    title: saved.rating <= 2 ? '客服服务收到低分评价' : '收到客服服务评价',
                    silent: saved.rating > 2,
                    payload: {
                        channelId: String(ctx.channelId),
                        rating: saved.rating,
                        serviceTags: tags.map(tag => feedbackTagLabels[tag]),
                        orderCode: saved.orderCode,
                        feedback: comment ? '客户提供了文字反馈，请在后台查看' : '未填写文字反馈',
                        adminPath: '/settings/system-ops?tab=telegram',
                    },
                },
                false,
                false,
            );
        }
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
            where: { code, customerId: customer.id, salesChannelId: ctx.channelId },
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
