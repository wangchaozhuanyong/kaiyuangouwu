import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    CustomerService,
    ID,
    Order,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationService, NotificationSignalService } from '@vendure/operations-dashboard-plugin';
import { createHmac } from 'node:crypto';

import { STOREFRONT_PROMOTION_OPTIONS } from '../constants';
import {
    CustomerServiceFeedbackService,
    CustomerServiceFeedbackView,
    feedbackTagLabels,
} from '../customer-service-feedback.service';
import { CustomerServiceFeedback } from '../entities/customer-service-feedback.entity';
import { CustomerServiceReview } from '../entities/customer-service-review.entity';
import {
    normalizeStorefrontVisitorId,
    resolveStorefrontVisitorIdentity,
} from '../referral/storefront-visitor-identity';
import { StorefrontPromotionPluginOptions } from '../types';

export const SERVICE_TAGS = ['响应迅速', '态度热情', '耐心专业', '问题已解决', '处理高效'] as const;
export interface ServiceReviewInput {
    id?: ID;
    visitorId: string;
    rating: number;
    tags: string[];
    comment: string;
    orderCode?: string | null;
}
export function validateServiceReview(input: ServiceReviewInput) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
        throw new UserInputError('评分必须为一至五星');
    if (
        !Array.isArray(input.tags) ||
        input.tags.length > 5 ||
        input.tags.some(tag => !SERVICE_TAGS.includes(tag as (typeof SERVICE_TAGS)[number]))
    )
        throw new UserInputError('服务评价标签无效');
    if (typeof input.comment !== 'string' || input.comment.length > 2000)
        throw new UserInputError('评价内容不能超过 2000 字');
    if (
        input.orderCode != null &&
        (typeof input.orderCode !== 'string' ||
            input.orderCode.length > 64 ||
            !/^[A-Za-z0-9_-]+$/.test(input.orderCode))
    )
        throw new UserInputError('订单编号格式无效');
    if (!normalizeStorefrontVisitorId(input.visitorId)) throw new UserInputError('访客标识无效');
    return { rating: input.rating, tags: [...new Set(input.tags)], comment: input.comment.trim() };
}

@Injectable()
export class CustomerServiceReviewService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customers: CustomerService,
        private readonly notifications: AdminNotificationService,
        private readonly signals: NotificationSignalService,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly options: Required<StorefrontPromotionPluginOptions>,
        private readonly legacyFeedback: CustomerServiceFeedbackService,
    ) {}

    async submit(ctx: RequestContext, input: ServiceReviewInput) {
        const values = validateServiceReview(input);
        const identity = resolveStorefrontVisitorIdentity({
            req: ctx.req,
            channelId: String(ctx.channelId),
            visitorId: input.visitorId,
            signingSecret: this.options.signingSecret,
        });
        if (!identity) throw new UserInputError('无法确认评价来源');
        const customer = ctx.activeUserId
            ? await this.customers.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        if (ctx.activeUserId && !customer) throw new UserInputError('请使用客户账号提交评价');
        const hash = (value: string) =>
            createHmac('sha256', this.options.signingSecret)
                .update(JSON.stringify(['service-review-v1', String(ctx.channelId), value]))
                .digest('hex');
        let order: Order | null = null;
        if (input.orderCode) {
            if (!customer) throw new UserInputError('请登录后评价关联订单');
            order = await this.connection.getRepository(ctx, Order).findOne({
                where: { code: input.orderCode, customerId: customer.id, salesChannelId: ctx.channelId },
            });
            if (!order) throw new UserInputError('订单不存在或不属于当前客户及店铺');
        }
        if (customer) {
            const previous = await this.legacyFeedback.myFeedback(ctx, input.orderCode);
            if (input.id && String(input.id) !== `feedback:${previous?.id}`)
                throw new UserInputError('无权修改此评价');
            const saved = await this.legacyFeedback.submit(ctx, {
                orderCode: input.orderCode,
                rating: values.rating,
                tags: values.tags.map(
                    tag =>
                        Object.keys(feedbackTagLabels).find(key => feedbackTagLabels[key] === tag) as string,
                ),
                comment: values.comment,
            });
            return { review: this.legacyView(saved), setCookie: identity.setCookie };
        }
        const ownerKey = hash(identity.keyMaterial);
        const budget = await this.signals.count(
            hash(`review-source:${identity.clientIp ?? identity.keyMaterial}`),
        );
        if (budget.count > 10) throw new UserInputError('评价提交过于频繁，请稍后再试');
        const submissionKey = hash(
            order
                ? `order:${order.id}`
                : `general:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())}`,
        );
        const repository = this.connection.getRepository(ctx, CustomerServiceReview);
        let review = input.id
            ? await repository.findOneBy({ id: input.id, channelId: ctx.channelId, ownerKey })
            : await repository.findOneBy({ channelId: ctx.channelId, ownerKey, submissionKey });
        if (input.id && !review) throw new UserInputError('无权修改此评价');
        if (review && String(review.orderId ?? '') !== String(order?.id ?? ''))
            throw new UserInputError('不能修改评价关联的订单');
        if (
            review &&
            review.rating === values.rating &&
            JSON.stringify(review.tags) === JSON.stringify(values.tags) &&
            review.comment === values.comment
        )
            return { review, setCookie: identity.setCookie };
        if (review && Date.now() - review.updatedAt.getTime() < 60_000)
            throw new UserInputError('评价修改过于频繁，请稍后重试');
        if (review) {
            const changed = await repository.update(
                { id: review.id, channelId: ctx.channelId, ownerKey, revision: review.revision },
                { ...values, revision: review.revision + 1 },
            );
            if (changed.affected !== 1) throw new UserInputError('评价已变化，请刷新后重试');
            review = await repository.findOneByOrFail({ id: review.id });
        } else {
            review = await repository.save(
                new CustomerServiceReview({
                    ...values,
                    channelId: ctx.channelId,
                    ownerKey,
                    submissionKey,
                    customerId: null,
                    orderId: order?.id ?? null,
                    orderCode: order?.code ?? null,
                    revision: 1,
                }),
            );
        }
        // The resolver transaction persists feedback and outbox together; minute reconciliation dispatches after commit.
        await this.notifications.enqueueOneOff(
            ctx,
            {
                eventType:
                    review.rating <= 2
                        ? 'commerce.service_review.negative'
                        : 'commerce.service_review.submitted',
                category: 'SERVICE_REVIEW',
                severity: review.rating <= 2 ? 'P1' : 'P3',
                dedupKey: `service-review:${review.id}:${review.revision}`,
                title: review.rating <= 2 ? '客服服务收到低分评价' : '收到客服服务评价',
                silent: review.rating > 2,
                payload: {
                    channelId: String(ctx.channelId),
                    rating: review.rating,
                    serviceTags: review.tags,
                    orderCode: review.orderCode,
                    feedback: review.comment ? '客户提供了文字反馈，请在后台查看' : '未填写文字反馈',
                    adminPath: '/settings/system-ops?tab=telegram',
                },
            },
            false,
            false,
        );
        return { review, setCookie: identity.setCookie };
    }

    async current(ctx: RequestContext, visitorId: string, orderCode?: string) {
        if (!normalizeStorefrontVisitorId(visitorId)) throw new UserInputError('访客标识无效');
        const identity = resolveStorefrontVisitorIdentity({
            req: ctx.req,
            channelId: String(ctx.channelId),
            visitorId,
            signingSecret: this.options.signingSecret,
        });
        if (!identity) return null;
        const customer = ctx.activeUserId
            ? await this.customers.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        if (ctx.activeUserId && !customer) return null;
        const hash = (value: string) =>
            createHmac('sha256', this.options.signingSecret)
                .update(JSON.stringify(['service-review-v1', String(ctx.channelId), value]))
                .digest('hex');
        let order: Order | null = null;
        if (orderCode) {
            if (!customer) return null;
            order = await this.connection.getRepository(ctx, Order).findOne({
                where: { code: orderCode, customerId: customer.id, salesChannelId: ctx.channelId },
            });
            if (!order) return null;
        }
        if (customer) {
            const record = await this.legacyFeedback.myFeedback(ctx, orderCode);
            return record ? this.legacyView(record) : null;
        }
        return this.connection.getRepository(ctx, CustomerServiceReview).findOneBy({
            channelId: ctx.channelId,
            ownerKey: hash(identity.keyMaterial),
            submissionKey: hash(
                order
                    ? `order:${order.id}`
                    : `general:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())}`,
            ),
        });
    }

    async list(ctx: RequestContext, skip = 0, take = 25, allStores = false) {
        if (
            allStores &&
            (ctx.channel.code !== DEFAULT_CHANNEL_CODE || !ctx.userHasPermissions([Permission.SuperAdmin]))
        )
            throw new UserInputError('仅平台管理员可查看全店评价');
        const offset = Math.max(0, Math.min(10_000, Math.trunc(skip)));
        const limit = Math.min(100, Math.max(1, Math.trunc(take)));
        const options = {
            where: allStores ? {} : { channelId: ctx.channelId },
            order: { createdAt: 'DESC' as const, id: 'DESC' as const },
            take: offset + limit,
        };
        const [[reviews, reviewCount], [feedback, feedbackCount]] = await Promise.all([
            this.connection.getRepository(ctx, CustomerServiceReview).findAndCount(options),
            this.connection.getRepository(ctx, CustomerServiceFeedback).findAndCount(options),
        ]);
        const items = [...reviews, ...feedback.map(record => this.legacyView(record))]
            .sort(
                (a, b) =>
                    b.createdAt.getTime() - a.createdAt.getTime() || String(b.id).localeCompare(String(a.id)),
            )
            .slice(offset, offset + limit);
        return { items, totalItems: reviewCount + feedbackCount };
    }

    private legacyView(record: CustomerServiceFeedback | CustomerServiceFeedbackView) {
        let codes: string[] = [];
        try {
            const parsed: unknown = JSON.parse(record.tagsJson);
            if (Array.isArray(parsed))
                codes = parsed.filter((item): item is string => typeof item === 'string');
        } catch {
            /* Keep malformed historical tags readable. */
        }
        return {
            ...record,
            id: `feedback:${record.id}`,
            tags: codes.map(code => feedbackTagLabels[code]).filter(Boolean),
            comment: record.comment ?? '',
            revision: record.notificationRevision,
        };
    }
}
