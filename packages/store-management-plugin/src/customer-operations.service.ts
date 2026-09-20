import { Injectable } from '@nestjs/common';
import type { CurrencyCode } from '@vendure/common/lib/generated-types';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    Channel,
    Customer,
    EntityNotFoundError,
    EventBus,
    Order,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { LessThanOrEqual, Like } from 'typeorm';
import type {
    CreateCustomerFollowUpInput,
    CustomerCurrencyMetric,
    CustomerFollowUpListOptions,
    CustomerOperationsProfileListOptions,
    UpdateCustomerFollowUpInput,
} from './customer-operations.types';

import {
    CustomerFollowUpEvent,
    type CustomerFollowUpEventType,
} from './entities/customer-follow-up-event.entity';
import { CustomerFollowUp } from './entities/customer-follow-up.entity';
import {
    type CustomerChurnRisk,
    CustomerOperationsProfile,
    type CustomerOperationsSegment,
} from './entities/customer-operations-profile.entity';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVALUATION_VERSION = 'customer-rfm-v1';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const TERMINAL_AFTER_SALES_STATES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

export interface CustomerOperationsProfileList {
    items: CustomerOperationsProfile[];
    totalItems: number;
}

export interface CustomerFollowUpList {
    items: CustomerFollowUp[];
    totalItems: number;
}

interface SegmentDecision {
    segment: CustomerOperationsSegment;
    churnRisk: CustomerChurnRisk;
    reasons: string[];
}

@Injectable()
export class CustomerOperationsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly contexts: RequestContextService,
        private readonly eventBus: EventBus,
    ) {}

    async findProfile(ctx: RequestContext, customerId: ID): Promise<CustomerOperationsProfile> {
        await this.customerInChannelOrThrow(ctx, customerId);
        let profile = await this.profileRepository(ctx).findOne({
            where: { channelId: ctx.channelId, customerId },
            relations: { customer: true },
        });
        if (!profile) profile = await this.evaluateCustomer(ctx, customerId);
        return profile;
    }

    async listProfiles(
        ctx: RequestContext,
        options: CustomerOperationsProfileListOptions = {},
    ): Promise<CustomerOperationsProfileList> {
        const take = boundedTake(options.take);
        const skip = boundedSkip(options.skip);
        const base = {
            channelId: ctx.channelId,
            ...(options.segment ? { segment: options.segment } : {}),
            ...(options.churnRisk ? { churnRisk: options.churnRisk } : {}),
            ...(options.followUpDue ? { nextFollowUpAt: LessThanOrEqual(new Date()) } : {}),
        };
        const search = normalizedOptional(options.search, 120);
        const where = search
            ? [
                  { ...base, customer: { firstName: Like(`%${search}%`) } },
                  { ...base, customer: { lastName: Like(`%${search}%`) } },
                  { ...base, customer: { emailAddress: Like(`%${search}%`) } },
                  { ...base, customer: { phoneNumber: Like(`%${search}%`) } },
              ]
            : base;
        const [items, totalItems] = await this.profileRepository(ctx).findAndCount({
            where,
            relations: { customer: true },
            order: { lastEvaluatedAt: 'DESC', id: 'ASC' },
            skip,
            take,
        });
        return { items, totalItems };
    }

    async listFollowUps(
        ctx: RequestContext,
        options: CustomerFollowUpListOptions = {},
    ): Promise<CustomerFollowUpList> {
        const status = options.status ?? 'OPEN';
        const where = {
            channelId: ctx.channelId,
            status,
            ...(options.priority ? { priority: options.priority } : {}),
            ...(options.customerId ? { customerId: options.customerId } : {}),
            ...(options.overdue ? { dueAt: LessThanOrEqual(new Date()) } : {}),
        };
        const [items, totalItems] = await this.followUpRepository(ctx).findAndCount({
            where,
            relations: { customer: true, profile: true, events: true },
            order: { dueAt: 'ASC', priority: 'ASC', id: 'ASC', events: { createdAt: 'ASC' } },
            skip: boundedSkip(options.skip),
            take: boundedTake(options.take),
        });
        return { items, totalItems };
    }

    async evaluateCustomer(ctx: RequestContext, customerId: ID): Promise<CustomerOperationsProfile> {
        const profile = await this.evaluateCustomerSnapshot(ctx, customerId);
        await this.rebalanceMonetaryScores(ctx);
        const rebalanced =
            (await this.profileRepository(ctx).findOne({
                where: { id: profile.id, channelId: ctx.channelId },
                relations: { customer: true },
            })) ?? profile;
        await this.ensureAutomaticFollowUp(ctx, rebalanced);
        return (
            (await this.profileRepository(ctx).findOne({
                where: { id: profile.id, channelId: ctx.channelId },
                relations: { customer: true },
            })) ?? rebalanced
        );
    }

    async createFollowUp(ctx: RequestContext, input: CreateCustomerFollowUpInput): Promise<CustomerFollowUp> {
        const idempotencyKey = normalizedIdempotencyKey(input.idempotencyKey);
        const existing = await this.followUpRepository(ctx).findOne({
            where: { channelId: ctx.channelId, idempotencyKey },
            relations: { customer: true, profile: true, events: true },
        });
        if (existing) return existing;
        const customer = await this.customerInChannelOrThrow(ctx, input.customerId);
        const profile = await this.findProfile(ctx, customer.id);
        const dueAt = validDueAt(input.dueAt);
        const title = requiredText(input.title, '跟进标题', 160);
        const note = requiredText(input.note, '跟进说明', 2000);
        return this.connection.withTransaction(ctx, async txCtx => {
            const duplicate = await this.followUpRepository(txCtx).findOne({
                where: { channelId: txCtx.channelId, idempotencyKey },
                relations: { customer: true, profile: true, events: true },
            });
            if (duplicate) return duplicate;
            const followUp = await this.followUpRepository(txCtx).save(
                new CustomerFollowUp({
                    channelId: txCtx.channelId,
                    customerId: customer.id,
                    profileId: profile.id,
                    status: 'OPEN',
                    source: 'ADMIN',
                    priority: input.priority,
                    reasonCode: 'MANUAL',
                    title,
                    note,
                    idempotencyKey,
                    dueAt,
                    ownerUserId: txCtx.activeUserId ?? null,
                    outcomeCode: null,
                    outcomeNote: null,
                    completedAt: null,
                    completedByUserId: null,
                }),
            );
            await this.appendEvent(txCtx, followUp, 'CREATED', idempotencyKey, note, {
                dueAt: dueAt.toISOString(),
                priority: input.priority,
            });
            await this.syncNextFollowUp(txCtx, profile.id);
            return this.followUpOrThrow(txCtx, followUp.id);
        });
    }

    async updateFollowUp(ctx: RequestContext, input: UpdateCustomerFollowUpInput): Promise<CustomerFollowUp> {
        if (!['RESCHEDULE', 'COMPLETE', 'DISMISS'].includes(input.action)) {
            throw new UserInputError('客户跟进操作无效');
        }
        const idempotencyKey = normalizedIdempotencyKey(input.idempotencyKey);
        const note = requiredText(input.note, '操作说明', 2000);
        const priorEvent = await this.eventRepository(ctx).findOne({
            where: { followUpId: input.id, idempotencyKey },
        });
        if (priorEvent) return this.followUpOrThrow(ctx, input.id);
        return this.connection.withTransaction(ctx, async txCtx => {
            const followUp = await this.followUpOrThrow(txCtx, input.id);
            const duplicate = await this.eventRepository(txCtx).findOne({
                where: { followUpId: followUp.id, idempotencyKey },
            });
            if (duplicate) return followUp;
            if (followUp.status !== 'OPEN') throw new UserInputError('该客户跟进已结束，不能再次变更');
            const now = new Date();
            if (input.action === 'RESCHEDULE') {
                const dueAt = validDueAt(input.dueAt);
                await this.commitOpenFollowUp(txCtx, followUp, { dueAt });
                await this.appendEvent(txCtx, followUp, 'RESCHEDULED', idempotencyKey, note, {
                    dueAt: dueAt.toISOString(),
                });
            } else if (input.action === 'COMPLETE') {
                if (!input.outcomeCode) throw new UserInputError('完成跟进时必须选择结果');
                await this.commitOpenFollowUp(txCtx, followUp, {
                    status: 'COMPLETED',
                    outcomeCode: input.outcomeCode,
                    outcomeNote: note,
                    completedAt: now,
                    completedByUserId: txCtx.activeUserId ?? null,
                });
                await this.appendEvent(txCtx, followUp, 'COMPLETED', idempotencyKey, note, {
                    outcomeCode: input.outcomeCode,
                });
                await this.applyOutcome(txCtx, followUp);
            } else {
                await this.commitOpenFollowUp(txCtx, followUp, {
                    status: 'DISMISSED',
                    outcomeCode: input.outcomeCode ?? 'NOT_NEEDED',
                    outcomeNote: note,
                    completedAt: now,
                    completedByUserId: txCtx.activeUserId ?? null,
                });
                await this.appendEvent(txCtx, followUp, 'DISMISSED', idempotencyKey, note, {
                    outcomeCode: followUp.outcomeCode,
                });
                await this.applyOutcome(txCtx, followUp);
            }
            await this.syncNextFollowUp(txCtx, followUp.profileId);
            return this.followUpOrThrow(txCtx, followUp.id);
        });
    }

    async reconcileAll(): Promise<{ evaluated: number; openFollowUps: number; overdue: number }> {
        const channels = await this.connection.rawConnection
            .getRepository(Channel)
            .find({ order: { id: 'ASC' } });
        let evaluated = 0;
        let openFollowUps = 0;
        let overdue = 0;
        for (const channel of channels) {
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            let skip = 0;
            for (;;) {
                const customers = await this.connection
                    .getRepository(ctx, Customer)
                    .createQueryBuilder('customer')
                    .innerJoin('customer.channels', 'customerChannel', 'customerChannel.id = :channelId', {
                        channelId: channel.id,
                    })
                    .orderBy('customer.id', 'ASC')
                    .skip(skip)
                    .take(MAX_PAGE_SIZE)
                    .getMany();
                if (!customers.length) break;
                for (const customer of customers) {
                    await this.evaluateCustomerSnapshot(ctx, customer.id);
                    evaluated += 1;
                }
                skip += customers.length;
                if (customers.length < MAX_PAGE_SIZE) break;
            }
            await this.rebalanceMonetaryScores(ctx);
            const profiles = await this.profileRepository(ctx).find({
                where: { channelId: channel.id },
                order: { id: 'ASC' },
            });
            for (const profile of profiles) await this.ensureAutomaticFollowUp(ctx, profile);
            const channelOpen = await this.followUpRepository(ctx).count({
                where: { channelId: channel.id, status: 'OPEN' },
            });
            const channelOverdue = await this.followUpRepository(ctx).count({
                where: { channelId: channel.id, status: 'OPEN', dueAt: LessThanOrEqual(new Date()) },
            });
            openFollowUps += channelOpen;
            overdue += channelOverdue;
            await this.publishQueueIncident(ctx, channelOpen, channelOverdue);
        }
        return { evaluated, openFollowUps, overdue };
    }

    currencyMetrics(profile: CustomerOperationsProfile): CustomerCurrencyMetric[] {
        try {
            const value = JSON.parse(profile.currencyMetricsJson) as CustomerCurrencyMetric[];
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    reasons(profile: CustomerOperationsProfile): string[] {
        try {
            const value = JSON.parse(profile.reasonsJson) as string[];
            return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
        } catch {
            return [];
        }
    }

    private async evaluateCustomerSnapshot(
        ctx: RequestContext,
        customerId: ID,
    ): Promise<CustomerOperationsProfile> {
        const customer = await this.customerInChannelOrThrow(ctx, customerId);
        const orders = await this.connection.getRepository(ctx, Order).find({
            where: { customerId, salesChannelId: ctx.channelId, active: false },
            relations: ['payments', 'payments.refunds'],
            order: { orderPlacedAt: 'DESC', id: 'DESC' },
        });
        const paidOrders = orders.filter(
            order =>
                order.state !== 'Cancelled' && order.payments?.some(payment => payment.state === 'Settled'),
        );
        const byCurrency = new Map<string, CustomerCurrencyMetric>();
        for (const order of paidOrders) {
            const currencyCode = String(order.currencyCode);
            const currencyMetric = byCurrency.get(currencyCode) ?? {
                currencyCode,
                orderCount: 0,
                grossRevenue: 0,
                refundTotal: 0,
                netLifetimeValue: 0,
                averageOrderValue: 0,
            };
            const refundTotal = (order.payments ?? [])
                .flatMap(payment => payment.refunds ?? [])
                .reduce((sum, refund) => sum + (refund.state === 'Settled' ? refund.total : 0), 0);
            currencyMetric.orderCount += 1;
            currencyMetric.grossRevenue += order.totalWithTax;
            currencyMetric.refundTotal += refundTotal;
            currencyMetric.netLifetimeValue += Math.max(0, order.totalWithTax - refundTotal);
            byCurrency.set(currencyCode, currencyMetric);
        }
        const currencyMetrics = [...byCurrency.values()]
            .map(metric => ({
                ...metric,
                averageOrderValue: metric.orderCount
                    ? Math.round(metric.netLifetimeValue / metric.orderCount)
                    : 0,
            }))
            .sort((left, right) => right.netLifetimeValue - left.netLifetimeValue);
        const preferredCurrency = String(paidOrders[0]?.currencyCode ?? ctx.channel.defaultCurrencyCode);
        const primary = currencyMetrics.find(metric => metric.currencyCode === preferredCurrency) ?? {
            currencyCode: preferredCurrency,
            orderCount: 0,
            grossRevenue: 0,
            refundTotal: 0,
            netLifetimeValue: 0,
            averageOrderValue: 0,
        };
        const lastOrderAt = paidOrders[0]?.orderPlacedAt ?? null;
        const recencyDays = lastOrderAt ? elapsedDays(lastOrderAt) : null;
        const [history, afterSales] = await Promise.all([
            this.customerHistorySummary(ctx, customer.id),
            this.afterSalesSummary(ctx, customer.id),
        ]);
        const current = await this.profileRepository(ctx).findOne({
            where: { channelId: ctx.channelId, customerId: customer.id },
        });
        const decision = deriveCustomerSegment({
            orderCount: paidOrders.length,
            recencyDays,
            monetaryScore: current?.monetaryScore ?? 0,
            registeredDays: elapsedDays(customer.createdAt),
        });
        const profile = current ?? new CustomerOperationsProfile();
        Object.assign(profile, {
            channelId: ctx.channelId,
            customerId: customer.id,
            segment: decision.segment,
            churnRisk: decision.churnRisk,
            recencyScore: scoreRecency(recencyDays),
            frequencyScore: scoreFrequency(paidOrders.length),
            monetaryScore: current?.monetaryScore ?? 0,
            recencyDays,
            orderCount: paidOrders.length,
            currencyCode: primary.currencyCode as CurrencyCode,
            grossRevenue: primary.grossRevenue,
            refundTotal: primary.refundTotal,
            netLifetimeValue: primary.netLifetimeValue,
            averageOrderValue: primary.averageOrderValue,
            currencyMetricsJson: JSON.stringify(currencyMetrics),
            serviceInteractionCount: history.total,
            afterSalesCount: afterSales.total,
            openAfterSalesCount: afterSales.open,
            lastOrderAt,
            lastServiceAt: latestDate(history.lastAt, afterSales.lastAt),
            nextFollowUpAt: current?.nextFollowUpAt ?? null,
            doNotContact: current?.doNotContact ?? false,
            reasonsJson: JSON.stringify(decision.reasons),
            evaluationVersion: EVALUATION_VERSION,
            lastEvaluatedAt: new Date(),
        } satisfies Partial<CustomerOperationsProfile>);
        return this.profileRepository(ctx).save(profile);
    }

    private async rebalanceMonetaryScores(ctx: RequestContext): Promise<void> {
        const profiles = await this.profileRepository(ctx).find({
            where: { channelId: ctx.channelId },
            relations: { customer: true },
            order: { id: 'ASC' },
        });
        const groups = new Map<string, CustomerOperationsProfile[]>();
        for (const profile of profiles) {
            const group = groups.get(profile.currencyCode) ?? [];
            group.push(profile);
            groups.set(profile.currencyCode, group);
        }
        for (const group of groups.values()) {
            const paying = group
                .filter(profile => profile.orderCount > 0)
                .sort(
                    (left, right) =>
                        left.netLifetimeValue - right.netLifetimeValue || Number(left.id) - Number(right.id),
                );
            const rankById = new Map(
                paying.map((profile, index) => [
                    String(profile.id),
                    Math.ceil(((index + 1) / paying.length) * 5),
                ]),
            );
            for (const profile of group) {
                const monetaryScore = rankById.get(String(profile.id)) ?? 0;
                const decision = deriveCustomerSegment({
                    orderCount: profile.orderCount,
                    recencyDays: profile.recencyDays,
                    monetaryScore,
                    registeredDays: elapsedDays(profile.customer?.createdAt ?? profile.createdAt),
                });
                profile.monetaryScore = monetaryScore;
                profile.segment = decision.segment;
                profile.churnRisk = decision.churnRisk;
                profile.reasonsJson = JSON.stringify(decision.reasons);
            }
            await this.profileRepository(ctx).save(group, { reload: false });
        }
    }

    private async ensureAutomaticFollowUp(
        ctx: RequestContext,
        profile: CustomerOperationsProfile,
    ): Promise<void> {
        const repository = this.followUpRepository(ctx);
        const open = await repository.find({
            where: {
                channelId: ctx.channelId,
                customerId: profile.customerId,
                source: 'SYSTEM',
                reasonCode: 'CHURN_RISK',
                status: 'OPEN',
            },
            order: { dueAt: 'ASC', id: 'ASC' },
        });
        const needsFollowUp =
            profile.orderCount > 0 &&
            !profile.doNotContact &&
            (profile.churnRisk === 'MEDIUM' || profile.churnRisk === 'HIGH');
        if (!needsFollowUp) {
            let staleTransitionObserved = false;
            for (const openFollowUp of open) {
                const recoveryNote = '客户风险已恢复，系统自动关闭跟进';
                const recoveryPatch: Partial<CustomerFollowUp> = {
                    status: 'DISMISSED',
                    outcomeCode: 'NOT_NEEDED',
                    outcomeNote: recoveryNote,
                    completedAt: new Date(),
                    completedByUserId: null,
                };
                const result = await repository.update(
                    { id: openFollowUp.id, channelId: ctx.channelId, status: 'OPEN' },
                    recoveryPatch,
                );
                if (result.affected !== 1) {
                    staleTransitionObserved = true;
                    continue;
                }
                Object.assign(openFollowUp, recoveryPatch);
                await this.appendEvent(
                    ctx,
                    openFollowUp,
                    'AUTO_RECOVERED',
                    `auto-recovered-${openFollowUp.id}`,
                    recoveryNote,
                    { segment: profile.segment, churnRisk: profile.churnRisk },
                );
            }
            if (staleTransitionObserved) {
                await this.syncNextFollowUp(ctx, profile.id);
            } else {
                profile.nextFollowUpAt = null;
                await this.profileRepository(ctx).save(profile, { reload: false });
            }
            return;
        }
        if (open.length) {
            profile.nextFollowUpAt = open[0].dueAt;
            await this.profileRepository(ctx).save(profile, { reload: false });
            return;
        }
        if (profile.nextFollowUpAt && profile.nextFollowUpAt > new Date()) return;
        const now = new Date();
        const dueAt = new Date(now.getTime() + (profile.churnRisk === 'HIGH' ? DAY_MS : 3 * DAY_MS));
        const cycleDate = (profile.nextFollowUpAt ?? profile.lastOrderAt ?? profile.createdAt)
            .toISOString()
            .slice(0, 10);
        const idempotencyKey = normalizedIdempotencyKey(
            `churn-${String(profile.customerId)}-${profile.churnRisk}-${cycleDate}`,
        );
        const duplicate = await repository.findOne({ where: { channelId: ctx.channelId, idempotencyKey } });
        if (duplicate) {
            profile.nextFollowUpAt = duplicate.status === 'OPEN' ? duplicate.dueAt : null;
            await this.profileRepository(ctx).save(profile, { reload: false });
            return;
        }
        const note = this.reasons(profile).join('；') || '客户复购间隔超过当前风险阈值';
        const followUp = await repository.save(
            new CustomerFollowUp({
                channelId: ctx.channelId,
                customerId: profile.customerId,
                profileId: profile.id,
                status: 'OPEN',
                source: 'SYSTEM',
                priority: profile.churnRisk === 'HIGH' ? 'P1' : 'P2',
                reasonCode: 'CHURN_RISK',
                title: profile.churnRisk === 'HIGH' ? '高流失风险客户跟进' : '复购风险客户跟进',
                note,
                idempotencyKey,
                dueAt,
                ownerUserId: null,
                outcomeCode: null,
                outcomeNote: null,
                completedAt: null,
                completedByUserId: null,
            }),
        );
        await this.appendEvent(ctx, followUp, 'CREATED', idempotencyKey, note, {
            segment: profile.segment,
            churnRisk: profile.churnRisk,
            dueAt: dueAt.toISOString(),
        });
        profile.nextFollowUpAt = dueAt;
        await this.profileRepository(ctx).save(profile, { reload: false });
    }

    private async applyOutcome(ctx: RequestContext, followUp: CustomerFollowUp): Promise<void> {
        const profile = await this.profileRepository(ctx).findOne({
            where: { id: followUp.profileId, channelId: ctx.channelId },
        });
        if (!profile) return;
        const now = followUp.completedAt ?? new Date();
        if (followUp.outcomeCode === 'DO_NOT_CONTACT') {
            profile.doNotContact = true;
            profile.nextFollowUpAt = null;
        } else if (followUp.outcomeCode === 'NO_RESPONSE') {
            profile.nextFollowUpAt = new Date(now.getTime() + 7 * DAY_MS);
        } else if (followUp.outcomeCode === 'CONTACTED') {
            profile.nextFollowUpAt = new Date(now.getTime() + 30 * DAY_MS);
        } else {
            profile.nextFollowUpAt = null;
        }
        await this.profileRepository(ctx).save(profile, { reload: false });
    }

    private async commitOpenFollowUp(
        ctx: RequestContext,
        followUp: CustomerFollowUp,
        patch: Partial<CustomerFollowUp>,
    ): Promise<void> {
        const result = await this.followUpRepository(ctx).update(
            { id: followUp.id, channelId: ctx.channelId, status: 'OPEN' },
            patch,
        );
        if (result.affected !== 1) {
            throw new UserInputError('客户跟进已被其他操作更新，请刷新后重试');
        }
        Object.assign(followUp, patch);
    }

    private async syncNextFollowUp(ctx: RequestContext, profileId: ID): Promise<void> {
        const next = await this.followUpRepository(ctx).findOne({
            where: { channelId: ctx.channelId, profileId, status: 'OPEN' },
            order: { dueAt: 'ASC', id: 'ASC' },
        });
        if (next) {
            await this.profileRepository(ctx).update(
                { id: profileId, channelId: ctx.channelId },
                { nextFollowUpAt: next.dueAt },
            );
        }
    }

    private async appendEvent(
        ctx: RequestContext,
        followUp: CustomerFollowUp,
        eventType: CustomerFollowUpEventType,
        idempotencyKey: string,
        note: string,
        payload: Record<string, unknown>,
    ): Promise<CustomerFollowUpEvent> {
        const existing = await this.eventRepository(ctx).findOne({
            where: { followUpId: followUp.id, idempotencyKey },
        });
        if (existing) return existing;
        return this.eventRepository(ctx).save(
            new CustomerFollowUpEvent({
                channelId: followUp.channelId,
                customerId: followUp.customerId,
                followUpId: followUp.id,
                eventType,
                idempotencyKey,
                actorType: ctx.activeUserId ? 'ADMIN' : 'SYSTEM',
                actorLabel: ctx.activeUserId ? `Administrator ${String(ctx.activeUserId)}` : 'System',
                actorUserId: ctx.activeUserId ?? null,
                note,
                payloadJson: JSON.stringify(payload),
            }),
        );
    }

    private async customerInChannelOrThrow(ctx: RequestContext, id: ID): Promise<Customer> {
        const customer = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .innerJoin('customer.channels', 'customerChannel', 'customerChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('customer.id = :id', { id })
            .getOne();
        if (!customer) throw new EntityNotFoundError(Customer.name, id);
        return customer;
    }

    private async followUpOrThrow(ctx: RequestContext, id: ID): Promise<CustomerFollowUp> {
        const followUp = await this.followUpRepository(ctx).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { customer: true, profile: true, events: true },
            order: { events: { createdAt: 'ASC' } },
        });
        if (!followUp) throw new EntityNotFoundError(CustomerFollowUp.name, id);
        return followUp;
    }

    private async afterSalesSummary(
        ctx: RequestContext,
        customerId: ID,
    ): Promise<{ total: number; open: number; lastAt: Date | null }> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(
            item => item.name === 'AfterSalesRequest',
        );
        if (!metadata?.findColumnWithPropertyName('customerId')) return { total: 0, open: 0, lastAt: null };
        const repository = this.connection.getRepository(ctx, metadata.target);
        const base = () =>
            repository
                .createQueryBuilder('service')
                .where('service.customerId = :customerId', { customerId })
                .andWhere('service.channelId = :channelId', { channelId: ctx.channelId });
        const [total, open, latest] = await Promise.all([
            base().getCount(),
            base()
                .andWhere('service.state NOT IN (:...terminalStates)', {
                    terminalStates: TERMINAL_AFTER_SALES_STATES,
                })
                .getCount(),
            base().orderBy('service.createdAt', 'DESC').getOne(),
        ]);
        return { total, open, lastAt: (latest as { createdAt?: Date } | null)?.createdAt ?? null };
    }

    private async customerHistorySummary(
        ctx: RequestContext,
        customerId: ID,
    ): Promise<{ total: number; lastAt: Date | null }> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(
            item => item.name === 'CustomerHistoryEntry',
        );
        if (!metadata) return { total: 0, lastAt: null };
        const repository = this.connection.getRepository(ctx, metadata.target);
        const relation = metadata.findRelationWithPropertyPath('customer');
        if (!relation) return { total: 0, lastAt: null };
        const base = () =>
            repository
                .createQueryBuilder('history')
                .innerJoin('history.customer', 'historyCustomer')
                .where('historyCustomer.id = :customerId', { customerId });
        const [total, latest] = await Promise.all([
            base().getCount(),
            base().orderBy('history.createdAt', 'DESC').getOne(),
        ]);
        return { total, lastAt: (latest as { createdAt?: Date } | null)?.createdAt ?? null };
    }

    private async publishQueueIncident(
        ctx: RequestContext,
        openFollowUps: number,
        overdueFollowUps: number,
    ): Promise<void> {
        await this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: overdueFollowUps ? 'INCIDENT_FIRING' : 'INCIDENT_RESOLVED',
                eventType: overdueFollowUps
                    ? 'customer.follow_up.overdue'
                    : 'customer.follow_up.queue_healthy',
                category: 'CUSTOMER_OPERATIONS',
                severity: 'P2',
                sourceType: 'CustomerFollowUpQueue',
                sourceId: String(ctx.channelId),
                fingerprint: `customer.follow-up.overdue:${String(ctx.channelId)}`,
                title: overdueFollowUps ? `${overdueFollowUps} 项客户跟进已逾期` : '客户跟进队列已恢复',
                payload: {
                    channelId: String(ctx.channelId),
                    openFollowUps,
                    overdueFollowUps,
                    adminPath: '/customers',
                },
            }),
        );
    }

    private profileRepository(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CustomerOperationsProfile);
    }

    private followUpRepository(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CustomerFollowUp);
    }

    private eventRepository(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CustomerFollowUpEvent);
    }
}

export function deriveCustomerSegment(input: {
    orderCount: number;
    recencyDays: number | null;
    monetaryScore: number;
    registeredDays: number;
}): SegmentDecision {
    if (!input.orderCount) {
        return input.registeredDays <= 30
            ? { segment: 'NEW', churnRisk: 'NONE', reasons: ['注册未满 30 天，尚无已结算订单'] }
            : { segment: 'LEAD', churnRisk: 'LOW', reasons: ['注册超过 30 天，尚无已结算订单'] };
    }
    const days = input.recencyDays ?? Number.MAX_SAFE_INTEGER;
    if (days >= 120) {
        return { segment: 'DORMANT', churnRisk: 'HIGH', reasons: [`最近一次购买已过去 ${days} 天`] };
    }
    if (days >= 60) {
        return { segment: 'AT_RISK', churnRisk: 'MEDIUM', reasons: [`最近一次购买已过去 ${days} 天`] };
    }
    if (input.orderCount >= 8 || (input.orderCount >= 4 && input.monetaryScore === 5)) {
        return {
            segment: 'VIP',
            churnRisk: 'LOW',
            reasons: [`已结算订单 ${input.orderCount} 笔，价值评分 ${input.monetaryScore}/5`],
        };
    }
    if (input.orderCount >= 3) {
        return { segment: 'LOYAL', churnRisk: 'LOW', reasons: [`已结算订单 ${input.orderCount} 笔`] };
    }
    return { segment: 'ACTIVE', churnRisk: 'LOW', reasons: [`最近 ${days} 天内有已结算订单`] };
}

export function scoreRecency(days: number | null): number {
    if (days == null) return 0;
    if (days <= 7) return 5;
    if (days <= 30) return 4;
    if (days <= 60) return 3;
    if (days <= 90) return 2;
    return 1;
}

export function scoreFrequency(orderCount: number): number {
    if (orderCount >= 10) return 5;
    if (orderCount >= 5) return 4;
    if (orderCount >= 3) return 3;
    if (orderCount >= 2) return 2;
    return orderCount ? 1 : 0;
}

function elapsedDays(date: Date): number {
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS));
}

function latestDate(left: Date | null, right: Date | null): Date | null {
    if (!left) return right;
    if (!right) return left;
    return left > right ? left : right;
}

function boundedTake(value: number | undefined): number {
    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(value ?? DEFAULT_PAGE_SIZE)));
}

function boundedSkip(value: number | undefined): number {
    return Math.max(0, Math.trunc(value ?? 0));
}

function requiredText(value: string | null | undefined, label: string, max: number): string {
    const normalized = value?.trim() ?? '';
    if (!normalized) throw new UserInputError(`${label}不能为空`);
    if (normalized.length > max) throw new UserInputError(`${label}不能超过 ${max} 个字符`);
    return normalized;
}

function normalizedOptional(value: string | null | undefined, max: number): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    return normalized.slice(0, max);
}

function normalizedIdempotencyKey(value: string): string {
    const normalized = value.trim();
    if (!/^[a-z0-9:_-]{8,96}$/iu.test(normalized)) {
        throw new UserInputError('幂等键必须是 8-96 位字母、数字、冒号、下划线或连字符');
    }
    return normalized;
}

function validDueAt(value: Date | string | null | undefined): Date {
    const dueAt = value instanceof Date ? value : new Date(value ?? '');
    if (Number.isNaN(dueAt.getTime())) throw new UserInputError('跟进时间无效');
    const now = Date.now();
    if (dueAt.getTime() < now - 5 * 60_000) throw new UserInputError('跟进时间不能早于当前时间');
    if (dueAt.getTime() > now + 366 * DAY_MS) throw new UserInputError('跟进时间不能超过一年');
    return dueAt;
}
