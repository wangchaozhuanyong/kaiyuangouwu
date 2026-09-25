import { Injectable } from '@nestjs/common';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    CustomerService,
    EventBus,
    Order,
    Payment,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { createHash } from 'node:crypto';

import { FraudRiskAppeal } from './entities/fraud-risk-appeal.entity';
import { FraudRiskCaseEvent } from './entities/fraud-risk-case-event.entity';
import { FraudRiskCase, FraudRiskCaseStatus } from './entities/fraud-risk-case.entity';
import { ReferralRelationship } from './entities/referral-relationship.entity';
import { derivedIdempotencyKey, GovernanceService, stableJson } from './governance.service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const ACTIVE_CASE_STATUSES: FraudRiskCaseStatus[] = ['OPEN', 'IN_REVIEW', 'APPEALED'];

export interface FraudRiskRules {
    enabled: boolean;
    highValueThreshold: number;
    velocityOrderCount: number;
    failedPaymentCount: number;
    reviewScore: number;
    holdScore: number;
}

export interface FraudRiskSignal {
    code: string;
    points: number;
    evidence: Record<string, unknown>;
}

export interface FraudRiskCaseListOptions {
    status?: FraudRiskCaseStatus | null;
    severity?: 'P1' | 'P2' | 'P3' | null;
    overdue?: boolean | null;
    skip?: number | null;
    take?: number | null;
}

export interface ReviewFraudRiskCaseInput {
    id: ID;
    action: 'CLAIM' | 'RELEASE' | 'BLOCK';
    reason: string;
    idempotencyKey: string;
}

export interface AppealFraudRiskCaseInput {
    id: ID;
    reason: string;
    idempotencyKey: string;
}

export const DEFAULT_FRAUD_RISK_RULES: FraudRiskRules = {
    enabled: true,
    highValueThreshold: 100_000,
    velocityOrderCount: 3,
    failedPaymentCount: 2,
    reviewScore: 40,
    holdScore: 60,
};

@Injectable()
export class FraudRiskService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customers: CustomerService,
        private readonly governance: GovernanceService,
        private readonly eventBus: EventBus,
        private readonly contexts: RequestContextService,
    ) {}

    async evaluateOrder(
        ctx: RequestContext,
        orderId: ID,
    ): Promise<{ blocked: boolean; caseCode: string | null; riskScore: number; action: string }> {
        // Order transition guards may run inside a transaction that is intentionally
        // rolled back when a hold is returned. Persist the review case in a detached
        // context so the evidence and recovery path survive that rollback.
        const evaluationCtx = await this.contexts.create({
            apiType: ctx.apiType,
            channelOrToken: ctx.channel,
            languageCode: ctx.languageCode,
            currencyCode: ctx.currencyCode,
        });
        const order = await this.connection
            .getRepository(evaluationCtx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('customer.user', 'user')
            .leftJoinAndSelect('order.payments', 'payment')
            .innerJoin('order.channels', 'riskChannel', 'riskChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('order.id = :orderId', { orderId })
            .getOne();
        if (!order) throw new UserInputError('风险评估订单不存在或不属于当前店铺');

        const configured = await this.governance.activeConfig<FraudRiskRules>(evaluationCtx, 'FRAUD_RULES');
        const rules = { ...DEFAULT_FRAUD_RISK_RULES, ...(configured?.value ?? {}) };
        const ruleVersion = configured
            ? `v${configured.version}:${configured.payloadHash.slice(0, 12)}`
            : 'default-v1';
        if (!rules.enabled) return { blocked: false, caseCode: null, riskScore: 0, action: 'ALLOW' };

        const facts = await this.orderRiskFacts(evaluationCtx, order);
        const signals = scoreOrderRiskSignals(facts, rules);
        const riskScore = signals.reduce((total, signal) => total + signal.points, 0);
        const subjectDigest = fraudRiskSubjectDigest({
            orderId: order.id,
            totalWithTax: order.totalWithTax,
            customerId: order.customerId ?? null,
            currencyCode: order.currencyCode,
            signals,
        });
        const previous = await this.connection.getRepository(evaluationCtx, FraudRiskCase).findOne({
            where: {
                channelId: ctx.channelId,
                subjectType: 'ORDER',
                subjectId: String(order.id),
                ruleVersion,
                subjectDigest,
            },
            order: { createdAt: 'DESC' },
        });
        if (previous) {
            const blocked = previous.status !== 'APPROVED' && previous.status !== 'CLOSED';
            return {
                blocked,
                caseCode: previous.caseCode,
                riskScore: previous.riskScore,
                action: blocked ? previous.recommendedAction : 'ALLOW',
            };
        }
        if (riskScore < rules.reviewScore) {
            await this.governance.appendAudit(evaluationCtx, {
                eventType: 'FRAUD_EVALUATION_ALLOWED',
                resourceType: 'Order',
                resourceId: order.id,
                actorType: 'SYSTEM',
                actorLabel: 'Fraud risk engine',
                reason: 'Risk score below the active manual-review threshold',
                payload: { riskScore, ruleVersion, subjectDigest, signals },
                idempotencyKey: `fraud-allow:${subjectDigest}`,
            });
            return { blocked: false, caseCode: null, riskScore, action: 'ALLOW' };
        }

        const idempotencyKey = `fraud-case:${sha256(`${String(ctx.channelId)}:${order.id}:${ruleVersion}:${subjectDigest}`).slice(0, 48)}`;
        const severity = riskScore >= rules.holdScore ? 'P1' : 'P2';
        const action = riskScore >= rules.holdScore ? 'HOLD_FULFILLMENT' : 'MANUAL_REVIEW';
        const repository = this.connection.getRepository(evaluationCtx, FraudRiskCase);
        let riskCase: FraudRiskCase;
        try {
            riskCase = await repository.save(
                new FraudRiskCase({
                    channelId: ctx.channelId,
                    caseCode: `FR-${sha256(idempotencyKey).slice(0, 12).toUpperCase()}`,
                    subjectType: 'ORDER',
                    subjectId: String(order.id),
                    orderId: order.id,
                    customerId: order.customerId ?? null,
                    status: 'OPEN',
                    severity,
                    riskScore,
                    ruleVersion,
                    subjectDigest,
                    signalsJson: stableJson(signals),
                    recommendedAction: action,
                    dueAt: new Date(Date.now() + (severity === 'P1' ? 2 * 60 * 60 * 1_000 : DAY_MS)),
                    ownerUserId: null,
                    decisionCode: null,
                    decisionReason: null,
                    decidedByUserId: null,
                    decidedAt: null,
                    idempotencyKey,
                }),
            );
        } catch (error) {
            const concurrent = await repository.findOneBy({ channelId: ctx.channelId, idempotencyKey });
            if (!concurrent) throw error;
            return {
                blocked: concurrent.status !== 'APPROVED' && concurrent.status !== 'CLOSED',
                caseCode: concurrent.caseCode,
                riskScore: concurrent.riskScore,
                action:
                    concurrent.status === 'APPROVED' || concurrent.status === 'CLOSED'
                        ? 'ALLOW'
                        : concurrent.recommendedAction,
            };
        }
        await this.appendEvent(evaluationCtx, riskCase, {
            eventType: 'CREATED',
            actorType: 'SYSTEM',
            actorUserId: null,
            note: '订单风险评分达到人工复核阈值',
            payload: { signals, riskScore, ruleVersion, subjectDigest },
            idempotencyKey: `${idempotencyKey}:created`,
        });
        await this.governance.appendAudit(evaluationCtx, {
            eventType: 'FRAUD_CASE_CREATED',
            resourceType: 'FraudRiskCase',
            resourceId: riskCase.id,
            actorType: 'SYSTEM',
            actorLabel: 'Fraud risk engine',
            reason: 'Order risk score reached the active manual-review threshold',
            payload: { caseCode: riskCase.caseCode, riskScore, severity, action, signals, ruleVersion },
            idempotencyKey: derivedIdempotencyKey('audit-fraud-case', idempotencyKey),
        });
        await this.publishCaseIncident(evaluationCtx, riskCase, true);
        return { blocked: true, caseCode: riskCase.caseCode, riskScore, action };
    }

    async listCases(ctx: RequestContext, options: FraudRiskCaseListOptions = {}) {
        const take = Math.min(Math.max(options.take ?? 50, 1), 200);
        const builder = this.connection
            .getRepository(ctx, FraudRiskCase)
            .createQueryBuilder('risk')
            .leftJoinAndSelect('risk.events', 'event')
            .leftJoinAndSelect('risk.appeals', 'appeal')
            .where('risk.channelId = :channelId', { channelId: ctx.channelId })
            .orderBy('risk.createdAt', 'DESC')
            .addOrderBy('event.createdAt', 'ASC')
            .addOrderBy('appeal.createdAt', 'ASC')
            .skip(Math.max(options.skip ?? 0, 0))
            .take(take);
        if (options.status) builder.andWhere('risk.status = :status', { status: options.status });
        if (options.severity) builder.andWhere('risk.severity = :severity', { severity: options.severity });
        if (options.overdue) {
            builder.andWhere('risk.status IN (:...activeStatuses) AND risk.dueAt <= :now', {
                activeStatuses: ACTIVE_CASE_STATUSES,
                now: new Date(),
            });
        }
        const [items, totalItems] = await builder.getManyAndCount();
        return { items, totalItems };
    }

    async myCases(ctx: RequestContext) {
        const customer = await this.activeCustomer(ctx);
        return this.connection.getRepository(ctx, FraudRiskCase).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            relations: { events: true, appeals: true },
            order: { createdAt: 'DESC' },
            take: 50,
        });
    }

    async reviewCase(ctx: RequestContext, input: ReviewFraudRiskCaseInput) {
        const actorUserId = requiredActor(ctx);
        const idempotencyKey = normalizeKey(input.idempotencyKey);
        const reason = requiredText(input.reason, 500, '复核说明');
        const repository = this.connection.getRepository(ctx, FraudRiskCase);
        const riskCase = await repository.findOne({
            where: { id: input.id, channelId: ctx.channelId },
            relations: { events: true, appeals: true },
        });
        if (!riskCase) throw new UserInputError('风险案件不存在或不属于当前店铺');
        const existingEvent = await this.connection.getRepository(ctx, FraudRiskCaseEvent).findOneBy({
            riskCaseId: riskCase.id,
            idempotencyKey,
        });
        if (existingEvent) return riskCase;

        if (input.action === 'CLAIM') {
            if (!ACTIVE_CASE_STATUSES.includes(riskCase.status)) throw new UserInputError('当前案件不能认领');
            if (riskCase.ownerUserId && riskCase.ownerUserId !== actorUserId) {
                throw new UserInputError('案件已由其他管理员认领');
            }
            riskCase.ownerUserId = actorUserId;
            riskCase.status = 'IN_REVIEW';
        } else {
            if (!ACTIVE_CASE_STATUSES.includes(riskCase.status) && riskCase.status !== 'REJECTED') {
                throw new UserInputError('当前案件不能作出复核决定');
            }
            riskCase.ownerUserId ??= actorUserId;
            riskCase.decisionCode = input.action;
            riskCase.decisionReason = reason;
            riskCase.decidedByUserId = actorUserId;
            riskCase.decidedAt = new Date();
            riskCase.status = input.action === 'RELEASE' ? 'APPROVED' : 'REJECTED';
            for (const appeal of riskCase.appeals.filter(item => item.status === 'PENDING')) {
                appeal.status = input.action === 'RELEASE' ? 'ACCEPTED' : 'REJECTED';
                appeal.response = reason;
                appeal.reviewedByUserId = actorUserId;
                appeal.reviewedAt = riskCase.decidedAt;
            }
            if (riskCase.appeals.length) {
                await this.connection
                    .getRepository(ctx, FraudRiskAppeal)
                    .save(riskCase.appeals, { reload: false });
            }
        }
        await repository.save(riskCase, { reload: false });
        await this.appendEvent(ctx, riskCase, {
            eventType:
                input.action === 'CLAIM'
                    ? 'REVIEW_STARTED'
                    : input.action === 'RELEASE'
                      ? 'RELEASED'
                      : 'BLOCKED',
            actorType: 'ADMIN',
            actorUserId,
            note: reason,
            payload: { action: input.action, status: riskCase.status },
            idempotencyKey,
        });
        await this.governance.appendAudit(ctx, {
            eventType: `FRAUD_CASE_${input.action}`,
            resourceType: 'FraudRiskCase',
            resourceId: riskCase.id,
            actorType: 'ADMIN',
            actorUserId,
            actorLabel: actorUserId,
            reason,
            payload: {
                caseCode: riskCase.caseCode,
                status: riskCase.status,
                decisionCode: riskCase.decisionCode,
            },
            idempotencyKey: derivedIdempotencyKey('audit-fraud-review', idempotencyKey),
        });
        if (input.action !== 'CLAIM') await this.publishCaseIncident(ctx, riskCase, false);
        return this.loadCase(ctx, riskCase.id);
    }

    async appealMine(ctx: RequestContext, input: AppealFraudRiskCaseInput) {
        const customer = await this.activeCustomer(ctx);
        const idempotencyKey = normalizeKey(input.idempotencyKey);
        const reason = requiredText(input.reason, 1_000, '申诉说明');
        const riskCase = await this.connection.getRepository(ctx, FraudRiskCase).findOne({
            where: { id: input.id, channelId: ctx.channelId, customerId: customer.id },
            relations: { appeals: true },
        });
        if (!riskCase) throw new UserInputError('风险案件不存在或不属于当前客户');
        const repository = this.connection.getRepository(ctx, FraudRiskAppeal);
        const existing = await repository.findOneBy({ riskCaseId: riskCase.id, idempotencyKey });
        if (existing) return existing;
        if (riskCase.appeals.length) throw new UserInputError('每个风险案件只能提交一次申诉');
        if (!['OPEN', 'REJECTED'].includes(riskCase.status)) throw new UserInputError('当前案件不能提交申诉');
        let appeal: FraudRiskAppeal;
        try {
            appeal = await repository.save(
                new FraudRiskAppeal({
                    channelId: ctx.channelId,
                    riskCaseId: riskCase.id,
                    riskCase,
                    customerId: customer.id,
                    status: 'PENDING',
                    reason,
                    response: null,
                    reviewedByUserId: null,
                    reviewedAt: null,
                    idempotencyKey,
                }),
            );
        } catch (error) {
            const concurrent = await repository.findOneBy({ riskCaseId: riskCase.id });
            if (concurrent?.idempotencyKey === idempotencyKey) return concurrent;
            if (concurrent) throw new UserInputError('每个风险案件只能提交一次申诉');
            throw error;
        }
        riskCase.status = 'APPEALED';
        riskCase.dueAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
        await this.connection.getRepository(ctx, FraudRiskCase).update(riskCase.id, {
            status: riskCase.status,
            dueAt: riskCase.dueAt,
        });
        await this.appendEvent(ctx, riskCase, {
            eventType: 'APPEALED',
            actorType: 'CUSTOMER',
            actorUserId: ctx.activeUserId == null ? null : String(ctx.activeUserId),
            note: reason,
            payload: { appealId: String(appeal.id) },
            idempotencyKey: derivedIdempotencyKey('appeal-event', idempotencyKey),
        });
        await this.governance.appendAudit(ctx, {
            eventType: 'FRAUD_CASE_APPEALED',
            resourceType: 'FraudRiskCase',
            resourceId: riskCase.id,
            actorType: 'CUSTOMER',
            actorUserId: ctx.activeUserId,
            actorLabel: `Customer ${String(customer.id)}`,
            reason: 'Customer submitted an appeal',
            payload: { caseCode: riskCase.caseCode, appealId: String(appeal.id) },
            idempotencyKey: derivedIdempotencyKey('audit-fraud-appeal', idempotencyKey),
        });
        await this.publishCaseIncident(ctx, riskCase, true);
        return appeal;
    }

    async reconcileOverdue(ctx: RequestContext): Promise<number> {
        const overdue = await this.connection
            .getRepository(ctx, FraudRiskCase)
            .createQueryBuilder('risk')
            .where('risk.channelId = :channelId AND risk.status IN (:...statuses) AND risk.dueAt <= :now', {
                channelId: ctx.channelId,
                statuses: ACTIVE_CASE_STATUSES,
                now: new Date(),
            })
            .take(200)
            .getMany();
        for (const riskCase of overdue) await this.publishCaseIncident(ctx, riskCase, true, true);
        return overdue.length;
    }

    private async orderRiskFacts(ctx: RequestContext, order: Order) {
        const customerId = order.customerId ?? null;
        const since = new Date(Date.now() - DAY_MS);
        const recentOrderCount = customerId
            ? await this.connection
                  .getRepository(ctx, Order)
                  .createQueryBuilder('order')
                  .innerJoin('order.channels', 'channel', 'channel.id = :channelId', {
                      channelId: ctx.channelId,
                  })
                  .where(
                      'order.customerId = :customerId AND order.id != :orderId AND order.createdAt >= :since',
                      {
                          customerId,
                          orderId: order.id,
                          since,
                      },
                  )
                  .andWhere('order.state NOT IN (:...ignored)', {
                      ignored: ['Created', 'Draft', 'AddingItems'],
                  })
                  .getCount()
            : 0;
        const failedPaymentCount = customerId
            ? await this.connection
                  .getRepository(ctx, Payment)
                  .createQueryBuilder('payment')
                  .innerJoin('payment.order', 'order')
                  .innerJoin('order.channels', 'channel', 'channel.id = :channelId', {
                      channelId: ctx.channelId,
                  })
                  .where('order.customerId = :customerId AND payment.createdAt >= :since', {
                      customerId,
                      since,
                  })
                  .andWhere('payment.state IN (:...states)', { states: ['Error', 'Declined', 'Cancelled'] })
                  .getCount()
            : 0;
        const referral = customerId
            ? await this.connection.getRepository(ctx, ReferralRelationship).findOneBy({
                  channelId: ctx.channelId,
                  inviteeCustomerId: customerId,
              })
            : null;
        return {
            totalWithTax: order.totalWithTax,
            currencyCode: order.currencyCode,
            hasCustomer: Boolean(customerId),
            customerAgeHours: order.customer?.createdAt
                ? Math.max(0, (Date.now() - order.customer.createdAt.getTime()) / (60 * 60 * 1_000))
                : null,
            recentOrderCount,
            failedPaymentCount,
            referralAgeHours: referral
                ? Math.max(0, (Date.now() - referral.boundAt.getTime()) / (60 * 60 * 1_000))
                : null,
            customerVerified: order.customer?.user?.verified ?? false,
        };
    }

    private appendEvent(
        ctx: RequestContext,
        riskCase: FraudRiskCase,
        input: {
            eventType: string;
            actorType: 'SYSTEM' | 'ADMIN' | 'CUSTOMER';
            actorUserId: string | null;
            note: string;
            payload: unknown;
            idempotencyKey: string;
        },
    ) {
        return this.connection.getRepository(ctx, FraudRiskCaseEvent).save(
            new FraudRiskCaseEvent({
                channelId: ctx.channelId,
                riskCaseId: riskCase.id,
                riskCase,
                eventType: input.eventType,
                actorType: input.actorType,
                actorUserId: input.actorUserId,
                note: input.note,
                payloadJson: stableJson(input.payload),
                idempotencyKey: normalizeKey(input.idempotencyKey),
            }),
        );
    }

    private loadCase(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, FraudRiskCase).findOneOrFail({
            where: { id, channelId: ctx.channelId },
            relations: { events: true, appeals: true },
        });
    }

    private async activeCustomer(ctx: RequestContext) {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customers.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }

    private publishCaseIncident(
        ctx: RequestContext,
        riskCase: FraudRiskCase,
        firing: boolean,
        overdue = false,
    ) {
        const fingerprint = `fraud.case:${String(riskCase.channelId)}:${riskCase.caseCode}`;
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                eventType: firing ? 'fraud.case.attention' : 'fraud.case.resolved',
                category: 'FRAUD_RISK',
                severity: overdue ? 'P1' : riskCase.severity,
                sourceType: 'FraudRiskCase',
                sourceId: String(riskCase.id),
                title: firing ? `风险案件待复核 ${riskCase.caseCode}` : `风险案件已决策 ${riskCase.caseCode}`,
                fingerprint,
                mode: firing ? 'INCIDENT_FIRING' : 'INCIDENT_RESOLVED',
                payload: {
                    summary: firing
                        ? `${overdue ? '案件已逾期；' : ''}评分 ${riskCase.riskScore}，状态 ${riskCase.status}`
                        : `决定 ${riskCase.decisionCode ?? riskCase.status}`,
                    caseCode: riskCase.caseCode,
                    orderId: riskCase.orderId == null ? null : String(riskCase.orderId),
                    customerId: riskCase.customerId == null ? null : String(riskCase.customerId),
                    riskScore: riskCase.riskScore,
                    status: riskCase.status,
                    dueAt: riskCase.dueAt.toISOString(),
                },
            }),
        );
    }
}

export function scoreOrderRiskSignals(
    facts: {
        totalWithTax: number;
        hasCustomer: boolean;
        customerAgeHours: number | null;
        recentOrderCount: number;
        failedPaymentCount: number;
        referralAgeHours: number | null;
        customerVerified: boolean;
    },
    rules: FraudRiskRules,
): FraudRiskSignal[] {
    const signals: FraudRiskSignal[] = [];
    if (!facts.hasCustomer) {
        signals.push({ code: 'NO_AUTHENTICATED_CUSTOMER', points: 60, evidence: {} });
    }
    if (facts.totalWithTax >= rules.highValueThreshold) {
        signals.push({
            code: 'HIGH_VALUE_ORDER',
            points: 30,
            evidence: { totalWithTax: facts.totalWithTax, threshold: rules.highValueThreshold },
        });
    }
    if (facts.customerAgeHours != null && facts.customerAgeHours <= 24) {
        signals.push({
            code: 'NEW_ACCOUNT',
            points: 25,
            evidence: { customerAgeHours: facts.customerAgeHours },
        });
    }
    if (!facts.customerVerified && facts.hasCustomer) {
        signals.push({ code: 'UNVERIFIED_ACCOUNT', points: 20, evidence: {} });
    }
    if (facts.recentOrderCount >= rules.velocityOrderCount) {
        signals.push({
            code: 'ORDER_VELOCITY',
            points: 25,
            evidence: { recentOrderCount: facts.recentOrderCount, threshold: rules.velocityOrderCount },
        });
    }
    if (facts.failedPaymentCount >= rules.failedPaymentCount) {
        signals.push({
            code: 'FAILED_PAYMENT_VELOCITY',
            points: 25,
            evidence: { failedPaymentCount: facts.failedPaymentCount, threshold: rules.failedPaymentCount },
        });
    }
    if (facts.referralAgeHours != null && facts.referralAgeHours <= 24) {
        signals.push({
            code: 'NEW_REFERRAL_BINDING',
            points: 15,
            evidence: { referralAgeHours: facts.referralAgeHours },
        });
    }
    return signals;
}

export function fraudRiskSubjectDigest(input: {
    orderId: ID;
    totalWithTax: number;
    customerId: ID | null;
    currencyCode: string;
    signals: FraudRiskSignal[];
}): string {
    // Ages change every millisecond while the risk signal is still the same.
    // Keep the precise ages in case evidence, but key a review to the stable
    // signal and its other evidence so an approved case can actually unblock.
    const signals = input.signals.map(signal => ({
        code: signal.code,
        points: signal.points,
        evidence: Object.fromEntries(
            Object.entries(signal.evidence).filter(
                ([key]) => key !== 'customerAgeHours' && key !== 'referralAgeHours',
            ),
        ),
    }));
    return sha256(
        stableJson({
            orderId: String(input.orderId),
            totalWithTax: input.totalWithTax,
            customerId: input.customerId == null ? null : String(input.customerId),
            currencyCode: input.currencyCode,
            signals,
        }),
    );
}

function requiredActor(ctx: RequestContext): string {
    if (!ctx.activeUserId) throw new UserInputError('缺少已认证的操作人');
    return String(ctx.activeUserId);
}

function requiredText(value: string, max: number, label: string): string {
    const normalized = value?.normalize('NFKC').trim();
    if (!normalized) throw new UserInputError(`${label}不能为空`);
    if (normalized.length > max) throw new UserInputError(`${label}不能超过 ${max} 个字符`);
    return normalized;
}

function normalizeKey(value: string): string {
    const key = requiredText(value, 96, '幂等键');
    if (!/^[a-zA-Z0-9:_-]{8,96}$/u.test(key)) throw new UserInputError('幂等键格式无效');
    return key;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
