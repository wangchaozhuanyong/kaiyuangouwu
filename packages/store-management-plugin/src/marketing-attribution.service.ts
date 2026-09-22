import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CurrencyCode, Permission } from '@vendure/common/lib/generated-types';
import {
    EventBus,
    ForbiddenError,
    Order,
    OrderStateTransitionEvent,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHmac } from 'node:crypto';

import { STOREFRONT_PROMOTION_OPTIONS } from './constants';
import { MarketingCampaignCost } from './entities/marketing-campaign-cost.entity';
import { StorefrontOrderAttribution } from './entities/storefront-order-attribution.entity';
import { StorefrontPageView } from './entities/storefront-page-view.entity';
import { resolveStorefrontVisitorIdentity } from './referral/storefront-visitor-identity';
import { StorefrontPromotionPluginOptions } from './types';

const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_REPORT_DAYS = 366;
export const RAW_MARKETING_ANALYTICS_RETENTION_DAYS = 90;

export interface MarketingAttributionReportInput {
    from: Date | string;
    to: Date | string;
    currencyCode?: CurrencyCode | null;
}

export interface RecordMarketingCampaignCostInput {
    businessDate: string;
    currencyCode: CurrencyCode;
    source: string;
    medium?: string | null;
    campaign?: string | null;
    amountMicrounits: number;
    idempotencyKey: string;
    reason: string;
}

interface AttributionDimensions {
    source: string;
    medium: string;
    campaign: string;
    term: string;
    content: string;
}

interface MarketingMetric extends AttributionDimensions {
    visitorKeys: Set<string>;
    searchTerms: Set<string>;
    contents: Set<string>;
    pageViewCount: number;
    productViewCount: number;
    cartViewCount: number;
    checkoutViewCount: number;
    orderCount: number;
    settledRevenueMicrounits: number;
    refundedRevenueMicrounits: number;
    campaignCostMicrounits: number;
}

@Injectable()
export class MarketingAttributionService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly eventBus: EventBus,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly options: Required<StorefrontPromotionPluginOptions>,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: OrderStateTransitionEvent,
            id: 'freeze-last-non-direct-marketing-attribution',
            handler: async event => {
                if (event.toState === 'PaymentSettled') {
                    await this.captureOrderAttribution(event.ctx, event.order.id, event.createdAt);
                }
            },
        });
    }

    attributionKey(channelId: string, keyMaterial: string): string {
        return marketingAttributionKey(this.options.signingSecret, channelId, keyMaterial);
    }

    async captureOrderAttribution(ctx: RequestContext, orderId: string | number, settledAt = new Date()) {
        const repository = this.connection.getRepository(ctx, StorefrontOrderAttribution);
        const existing = await repository.findOneBy({ channelId: ctx.channelId, orderId });
        if (existing) return existing;

        const order = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .innerJoin('order.channels', 'attributionChannel', 'attributionChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('order.id = :orderId', { orderId })
            .getOne();
        if (!order) return null;

        const channelId = String(ctx.channelId);
        const identity = order.customer
            ? `customer:${String(order.customer.id)}`
            : resolveStorefrontVisitorIdentity({
                  req: ctx.req,
                  channelId,
                  visitorId: null,
                  signingSecret: this.options.signingSecret,
              })?.keyMaterial;
        const attributionKeyHash = identity ? this.attributionKey(channelId, identity) : null;
        const windowStart = new Date(settledAt.getTime() - ATTRIBUTION_WINDOW_MS);
        const touch = attributionKeyHash
            ? await this.connection
                  .getRepository(ctx, StorefrontPageView)
                  .createQueryBuilder('view')
                  .where('view.channelId = :channelId', { channelId: ctx.channelId })
                  .andWhere('view.attributionKeyHash = :attributionKeyHash', { attributionKeyHash })
                  .andWhere('view.createdAt >= :windowStart AND view.createdAt <= :settledAt', {
                      windowStart,
                      settledAt,
                  })
                  .andWhere(
                      '(view.source IS NOT NULL OR view.medium IS NOT NULL OR view.campaign IS NOT NULL OR view.referrerHost IS NOT NULL)',
                  )
                  .orderBy('view.createdAt', 'DESC')
                  .addOrderBy('view.id', 'DESC')
                  .getOne()
            : null;
        const dimensions = touch ? dimensionsFrom(touch) : directDimensions();
        const record = repository.create({
            channelId: ctx.channelId,
            orderId: order.id,
            touchEventId: touch?.eventId ?? null,
            attributionModel: 'LAST_NON_DIRECT_30D',
            ...dimensions,
            landingPath: touch?.path ?? null,
            referrerHost: touch?.referrerHost ?? null,
            touchAt: touch?.createdAt ?? settledAt,
        });
        try {
            return await repository.save(record);
        } catch (error) {
            const concurrent = await repository.findOneBy({ channelId: ctx.channelId, orderId: order.id });
            if (concurrent) return concurrent;
            throw error;
        }
    }

    async recordCost(ctx: RequestContext, input: RecordMarketingCampaignCostInput) {
        this.requireWrite(ctx);
        const businessDate = normalizeBusinessDate(input.businessDate);
        if (!Number.isSafeInteger(input.amountMicrounits) || input.amountMicrounits === 0) {
            throw new UserInputError('营销费用必须是非 0 的整数微单位，冲正请使用负数');
        }
        const idempotencyKey = normalizeText(input.idempotencyKey, 96, '幂等键');
        if (!/^[a-zA-Z0-9:_-]{8,96}$/u.test(idempotencyKey)) {
            throw new UserInputError('营销费用幂等键格式无效');
        }
        const repository = this.connection.getRepository(ctx, MarketingCampaignCost);
        const existing = await repository.findOneBy({ channelId: ctx.channelId, idempotencyKey });
        const normalized = {
            businessDate,
            currencyCode: input.currencyCode,
            source: normalizeDimension(input.source, 'direct'),
            medium: normalizeDimension(input.medium, '(none)'),
            campaign: normalizeDimension(input.campaign, '(not set)'),
            amountMicrounits: input.amountMicrounits,
            reason: normalizeText(input.reason, 500, '费用原因'),
        };
        if (existing) {
            if (
                existing.businessDate !== normalized.businessDate ||
                existing.currencyCode !== normalized.currencyCode ||
                existing.source !== normalized.source ||
                existing.medium !== normalized.medium ||
                existing.campaign !== normalized.campaign ||
                Number(existing.amountMicrounits) !== normalized.amountMicrounits ||
                existing.reason !== normalized.reason
            ) {
                throw new UserInputError('该幂等键已用于不同的营销费用记录');
            }
            return costView(existing);
        }
        const saved = await repository.save(
            repository.create({
                channelId: ctx.channelId,
                ...normalized,
                amountMicrounits: String(normalized.amountMicrounits),
                idempotencyKey,
                actorUserId: ctx.activeUserId ? String(ctx.activeUserId) : null,
            }),
        );
        return costView(saved);
    }

    async report(ctx: RequestContext, input: MarketingAttributionReportInput) {
        this.requireRead(ctx);
        const { from, to } = normalizeRange(input);
        const currencyCode = input.currencyCode ?? ctx.channel.defaultCurrencyCode;
        const [views, attributions, costs] = await Promise.all([
            this.connection
                .getRepository(ctx, StorefrontPageView)
                .createQueryBuilder('view')
                .where('view.channelId = :channelId', { channelId: ctx.channelId })
                .andWhere('view.createdAt >= :from AND view.createdAt <= :to', { from, to })
                .orderBy('view.createdAt', 'ASC')
                .getMany(),
            this.connection
                .getRepository(ctx, StorefrontOrderAttribution)
                .createQueryBuilder('attribution')
                .innerJoinAndSelect('attribution.order', 'order')
                .leftJoinAndSelect('order.payments', 'payment')
                .leftJoinAndSelect('payment.refunds', 'refund')
                .where('attribution.channelId = :channelId', { channelId: ctx.channelId })
                .andWhere('order.orderPlacedAt >= :from AND order.orderPlacedAt <= :to', { from, to })
                .andWhere('order.currencyCode = :currencyCode', { currencyCode })
                .orderBy('order.orderPlacedAt', 'ASC')
                .getMany(),
            this.connection
                .getRepository(ctx, MarketingCampaignCost)
                .createQueryBuilder('cost')
                .where('cost.channelId = :channelId', { channelId: ctx.channelId })
                .andWhere('cost.currencyCode = :currencyCode', { currencyCode })
                .andWhere('cost.businessDate >= :fromDate AND cost.businessDate <= :toDate', {
                    fromDate: businessDateKey(from),
                    toDate: businessDateKey(to),
                })
                .orderBy('cost.businessDate', 'ASC')
                .getMany(),
        ]);

        const metrics = new Map<string, MarketingMetric>();
        for (const view of views) {
            const metric = metricFor(metrics, dimensionsFrom(view));
            if (view.attributionKeyHash) metric.visitorKeys.add(view.attributionKeyHash);
            metric.pageViewCount += 1;
            const path = view.path ?? '';
            if (/^\/products?\//u.test(path)) metric.productViewCount += 1;
            if (/^\/cart(?:\/|\?|$)/u.test(path)) metric.cartViewCount += 1;
            if (/^\/checkout(?:\/|\?|$)/u.test(path)) metric.checkoutViewCount += 1;
        }
        for (const attribution of attributions) {
            const metric = metricFor(metrics, dimensionsFrom(attribution));
            const payments = attribution.order.payments ?? [];
            const settledRevenue = payments
                .filter(payment => payment.state === 'Settled')
                .reduce((total, payment) => total + payment.amount, 0);
            if (settledRevenue <= 0) continue;
            metric.orderCount += 1;
            metric.settledRevenueMicrounits += settledRevenue * 10;
            metric.refundedRevenueMicrounits +=
                payments
                    .flatMap(payment => payment.refunds ?? [])
                    .filter(refund => refund.state === 'Settled')
                    .reduce((total, refund) => total + refund.total, 0) * 10;
        }
        for (const cost of costs) {
            metricFor(metrics, dimensionsFrom(cost)).campaignCostMicrounits += Number(cost.amountMicrounits);
        }

        const rows = [...metrics.values()]
            .map(metric => metricView(metric))
            .sort(
                (left, right) =>
                    right.netRevenueMicrounits - left.netRevenueMicrounits ||
                    right.visitorCount - left.visitorCount ||
                    dimensionKey(left).localeCompare(dimensionKey(right)),
            );
        const summaryMetric = emptyMetric({
            source: 'ALL',
            medium: 'ALL',
            campaign: 'ALL',
            term: 'ALL',
            content: 'ALL',
        });
        for (const row of rows) {
            summaryMetric.pageViewCount += row.pageViewCount;
            summaryMetric.productViewCount += row.productViewCount;
            summaryMetric.cartViewCount += row.cartViewCount;
            summaryMetric.checkoutViewCount += row.checkoutViewCount;
            summaryMetric.orderCount += row.orderCount;
            summaryMetric.settledRevenueMicrounits += row.settledRevenueMicrounits;
            summaryMetric.refundedRevenueMicrounits += row.refundedRevenueMicrounits;
            summaryMetric.campaignCostMicrounits += row.campaignCostMicrounits;
        }
        const uniqueVisitors = new Set(views.map(view => view.attributionKeyHash).filter(Boolean));
        summaryMetric.visitorKeys = uniqueVisitors as Set<string>;
        return {
            from,
            to,
            currencyCode,
            attributionModel: 'LAST_NON_DIRECT_30D',
            summary: metricView(summaryMetric),
            items: rows,
            costEntries: costs.map(costView),
        };
    }

    async purgeExpiredRawTraffic(ctx: RequestContext, now = new Date()) {
        const cutoff = new Date(
            now.getTime() - RAW_MARKETING_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        );
        const result = await this.connection
            .getRepository(ctx, StorefrontPageView)
            .createQueryBuilder()
            .delete()
            .from(StorefrontPageView)
            .where('createdAt < :cutoff', { cutoff })
            .execute();
        return { cutoff, deletedCount: result.affected ?? 0 };
    }

    private requireRead(ctx: RequestContext): void {
        if (!ctx.userHasPermissions([Permission.ReadOrder, Permission.ReadPromotion]))
            throw new ForbiddenError();
    }

    private requireWrite(ctx: RequestContext): void {
        if (!ctx.userHasPermissions([Permission.UpdatePromotion])) throw new ForbiddenError();
    }
}

function dimensionsFrom(input: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    term?: string | null;
    content?: string | null;
    referrerHost?: string | null;
}): AttributionDimensions {
    const source = normalizeDimension(input.source, input.referrerHost ? input.referrerHost : 'direct');
    return {
        source,
        medium: normalizeDimension(input.medium, source === 'direct' ? '(none)' : 'referral'),
        campaign: normalizeDimension(input.campaign, '(not set)'),
        term: normalizeDimension(input.term, '(not set)'),
        content: normalizeDimension(input.content, '(not set)'),
    };
}

function directDimensions(): AttributionDimensions {
    return {
        source: 'direct',
        medium: '(none)',
        campaign: '(not set)',
        term: '(not set)',
        content: '(not set)',
    };
}

function normalizeDimension(value: string | null | undefined, fallback: string): string {
    const normalized = String(value ?? '')
        .normalize('NFKC')
        .trim()
        .toLowerCase();
    return normalized || fallback;
}

function normalizeText(value: string, max: number, label: string): string {
    const normalized = String(value ?? '')
        .normalize('NFKC')
        .trim();
    if (!normalized || normalized.length > max) throw new UserInputError(`${label}长度无效`);
    return normalized;
}

function normalizeBusinessDate(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
        throw new UserInputError('营销费用日期无效');
    }
    return normalized;
}

function normalizeRange(input: MarketingAttributionReportInput): { from: Date; to: Date } {
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
        throw new UserInputError('营销报表日期范围无效');
    }
    if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * 24 * 60 * 60 * 1_000) {
        throw new UserInputError(`营销报表单次最多查询 ${MAX_REPORT_DAYS} 天`);
    }
    return { from, to };
}

function businessDateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function dimensionKey(input: AttributionDimensions): string {
    return JSON.stringify([input.source, input.medium, input.campaign]);
}

function emptyMetric(dimensions: AttributionDimensions): MarketingMetric {
    return {
        ...dimensions,
        visitorKeys: new Set(),
        searchTerms: new Set(dimensions.term === '(not set)' ? [] : [dimensions.term]),
        contents: new Set(dimensions.content === '(not set)' ? [] : [dimensions.content]),
        pageViewCount: 0,
        productViewCount: 0,
        cartViewCount: 0,
        checkoutViewCount: 0,
        orderCount: 0,
        settledRevenueMicrounits: 0,
        refundedRevenueMicrounits: 0,
        campaignCostMicrounits: 0,
    };
}

function metricFor(
    metrics: Map<string, MarketingMetric>,
    dimensions: AttributionDimensions,
): MarketingMetric {
    const key = dimensionKey(dimensions);
    const metric = metrics.get(key) ?? emptyMetric(dimensions);
    if (dimensions.term !== '(not set)') metric.searchTerms.add(dimensions.term);
    if (dimensions.content !== '(not set)') metric.contents.add(dimensions.content);
    metric.term =
        metric.searchTerms.size === 1
            ? [...metric.searchTerms][0]
            : metric.searchTerms.size
              ? '(multiple)'
              : '(not set)';
    metric.content =
        metric.contents.size === 1
            ? [...metric.contents][0]
            : metric.contents.size
              ? '(multiple)'
              : '(not set)';
    metrics.set(key, metric);
    return metric;
}

function metricView(metric: MarketingMetric) {
    const visitorCount = metric.visitorKeys.size;
    const netRevenueMicrounits = metric.settledRevenueMicrounits - metric.refundedRevenueMicrounits;
    return {
        source: metric.source,
        medium: metric.medium,
        campaign: metric.campaign,
        term: metric.term,
        content: metric.content,
        searchTerms: [...metric.searchTerms].sort(),
        visitorCount,
        pageViewCount: metric.pageViewCount,
        productViewCount: metric.productViewCount,
        cartViewCount: metric.cartViewCount,
        checkoutViewCount: metric.checkoutViewCount,
        orderCount: metric.orderCount,
        conversionRate: visitorCount > 0 ? metric.orderCount / visitorCount : null,
        settledRevenueMicrounits: metric.settledRevenueMicrounits,
        refundedRevenueMicrounits: metric.refundedRevenueMicrounits,
        netRevenueMicrounits,
        campaignCostMicrounits: metric.campaignCostMicrounits,
        refundAdjustedRoas:
            metric.campaignCostMicrounits > 0 ? netRevenueMicrounits / metric.campaignCostMicrounits : null,
        refundAdjustedRoi:
            metric.campaignCostMicrounits > 0
                ? (netRevenueMicrounits - metric.campaignCostMicrounits) / metric.campaignCostMicrounits
                : null,
    };
}

export function marketingAttributionKey(
    signingSecret: string,
    channelId: string,
    keyMaterial: string,
): string {
    return createHmac('sha256', signingSecret)
        .update(JSON.stringify(['storefront-attribution-v1', channelId, keyMaterial]))
        .digest('hex');
}

function costView(cost: MarketingCampaignCost) {
    return {
        id: String(cost.id),
        createdAt: cost.createdAt,
        businessDate: cost.businessDate,
        currencyCode: cost.currencyCode,
        source: cost.source,
        medium: cost.medium,
        campaign: cost.campaign,
        amountMicrounits: Number(cost.amountMicrounits),
        idempotencyKey: cost.idempotencyKey,
        actorUserId: cost.actorUserId,
        reason: cost.reason,
    };
}
