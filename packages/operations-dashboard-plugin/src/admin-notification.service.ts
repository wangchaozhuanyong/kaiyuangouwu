import { Injectable, Logger } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { IsNull, LessThanOrEqual, Not } from 'typeorm';

import { AdminNotificationConfigService } from './admin-notification-config.service';
import {
    DepartmentCode,
    DepartmentNotificationRouter,
    NotificationSeverity,
} from './department-notification-router';
import {
    AdminNotificationDelivery,
    IncidentStatus,
    NotificationDeliveryStatus,
    NotificationEventState,
    NotificationMode,
} from './entities/admin-notification-delivery.entity';
import { IncidentResponseService, incidentWorkflowPolicy } from './incident-response.service';
import { boundedText, normalizedOptional, sanitizePayload } from './notification-payload';
import { TelegramNotificationWorkerService } from './telegram-notification-worker.service';

const LOGGER_CTX = 'AdminNotificationService';

export interface AdminNotificationInput {
    eventType: string;
    category: string;
    severity: NotificationSeverity;
    sourceType?: string | null;
    sourceId?: string | null;
    dedupKey?: string | null;
    fingerprint?: string | null;
    title: string;
    payload?: Record<string, unknown>;
    priority?: number;
    silent?: boolean;
    occurredAt?: Date;
}

export interface NotificationDeliveryListOptions {
    skip?: number | null;
    take?: number | null;
    status?: NotificationDeliveryStatus | null;
}

@Injectable()
export class AdminNotificationService {
    private readonly router = new DepartmentNotificationRouter();

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: AdminNotificationConfigService,
        private readonly worker: TelegramNotificationWorkerService,
        private readonly incidentResponse: IncidentResponseService,
    ) {}

    async enqueueOneOff(ctx: RequestContext | null, input: AdminNotificationInput, force = false) {
        return this.enqueue(ctx, input, 'ONE_OFF', 'INFO', force);
    }

    async upsertIncident(ctx: RequestContext | null, input: AdminNotificationInput, force = false) {
        if (!input.fingerprint?.trim()) throw new Error('持续事件必须提供 fingerprint');
        const config = await this.configService.get();
        const shouldDeliver = force ? true : this.shouldEnqueue(config, input);
        const fingerprint = boundedText(input.fingerprint, 255);
        const updated = await this.inTransaction(ctx, async txCtx => {
            const repository = this.repository(txCtx);
            const current = supportsWriteLock(this.connection.rawConnection.options.type)
                ? await repository
                      .createQueryBuilder('incident')
                      .where('incident.activeFingerprint = :fingerprint', { fingerprint })
                      .setLock('pessimistic_write')
                      .getOne()
                : await repository.findOne({ where: { activeFingerprint: fingerprint } });
            if (!current) return null;
            const now = input.occurredAt ?? new Date();
            current.occurrenceCount += 1;
            current.lastOccurredAt = now;
            current.payload = sanitizePayload(input.payload ?? {});
            current.title = boundedText(input.title, 300);
            current.severity = input.severity;
            const repeatMinutes = input.severity === 'P0' ? config.p0RepeatMinutes : config.p1RepeatMinutes;
            const repeatDue =
                (input.severity === 'P0' || input.severity === 'P1') &&
                (!current.sentAt || now.getTime() - current.sentAt.getTime() >= repeatMinutes * 60_000);
            if (repeatDue && shouldDeliver) {
                current.deliveryAction = current.telegramMessageId ? 'EDIT' : 'SEND';
                current.deliveryStatus = 'PENDING';
                current.availableAt = now;
                current.claimedAt = null;
                current.claimedBy = null;
            }
            await repository.save(current);
            await this.incidentResponse.appendSystemEvidence(
                txCtx,
                current,
                'OCCURRED',
                '事故仍在持续',
                {
                    occurrenceCount: current.occurrenceCount,
                    severity: current.severity,
                    payload: current.payload,
                },
                now,
            );
            return { incident: current, repeatDue };
        });
        if (!updated) return this.enqueue(ctx, input, 'INCIDENT', 'FIRING', force);
        if (updated.repeatDue && shouldDeliver) await this.worker.dispatch(updated.incident.id);
        return updated.incident;
    }

    async resolveIncident(
        ctx: RequestContext | null,
        fingerprint: string,
        payload: Record<string, unknown> = {},
    ) {
        const config = await this.configService.get();
        const delivery = await this.inTransaction(ctx, async txCtx => {
            const repository = this.repository(txCtx);
            const normalizedFingerprint = boundedText(fingerprint, 255);
            const current = supportsWriteLock(this.connection.rawConnection.options.type)
                ? await repository
                      .createQueryBuilder('incident')
                      .where('incident.activeFingerprint = :fingerprint', {
                          fingerprint: normalizedFingerprint,
                      })
                      .setLock('pessimistic_write')
                      .getOne()
                : await repository.findOne({
                      where: { activeFingerprint: normalizedFingerprint },
                  });
            if (!current) return null;
            const resolvedAt = new Date();
            current.activeFingerprint = null;
            current.eventState = 'RESOLVED';
            current.resolvedAt = resolvedAt;
            current.lastOccurredAt = resolvedAt;
            current.payload = sanitizePayload({ ...current.payload, ...payload });
            current.recoveryObservedAt = resolvedAt;
            const severity = current.severity === 'P0' || current.severity === 'P1' ? current.severity : null;
            current.incidentStatus = severity ? 'RECOVERY_PENDING' : 'CLOSED';
            current.recoveryValidationDueAt = severity
                ? new Date(
                      resolvedAt.getTime() +
                          incidentWorkflowPolicy.recoveryValidationMinutes[severity] * 60_000,
                  )
                : null;
            current.closedAt = severity ? null : resolvedAt;
            current.deliveryAction = current.telegramMessageId ? 'EDIT' : 'SEND';
            current.deliveryStatus = config.sendResolved && config.enabled ? 'PENDING' : 'SKIPPED';
            current.availableAt = resolvedAt;
            current.silent = true;
            current.claimedAt = null;
            current.claimedBy = null;
            await repository.save(current);
            await this.incidentResponse.appendSystemEvidence(
                txCtx,
                current,
                'RECOVERY_OBSERVED',
                severity ? '系统已观测恢复，等待人工验证' : '系统已恢复，事故自动闭环',
                { payload: current.payload, recoveryValidationDueAt: current.recoveryValidationDueAt },
                resolvedAt,
            );
            if (!severity) {
                await this.incidentResponse.appendSystemEvidence(
                    txCtx,
                    current,
                    'CLOSED',
                    'P2/P3 事故恢复后自动闭环',
                    {},
                    resolvedAt,
                );
            }
            return current;
        });
        if (!delivery) return null;
        if (delivery.deliveryStatus === 'PENDING') await this.worker.dispatch(delivery.id);
        return delivery;
    }

    async retryDelivery(id: ID): Promise<AdminNotificationDelivery> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const delivery = await repository.findOne({ where: { id } });
        if (!delivery) throw new Error('通知记录不存在');
        if (!['DEAD', 'RETRY'].includes(delivery.deliveryStatus)) {
            throw new Error('只能重试失败或死信状态的通知');
        }
        delivery.deliveryStatus = 'RETRY';
        delivery.availableAt = new Date();
        delivery.claimedAt = null;
        delivery.claimedBy = null;
        delivery.lastErrorCode = null;
        delivery.lastError = null;
        await repository.save(delivery);
        await this.worker.dispatch(delivery.id);
        return delivery;
    }

    async listDeliveries(options: NotificationDeliveryListOptions = {}) {
        const take = Math.min(100, Math.max(1, Math.trunc(options.take ?? 25)));
        const skip = Math.max(0, Math.trunc(options.skip ?? 0));
        const where = options.status ? { deliveryStatus: options.status } : {};
        const [items, totalItems] = await this.connection.rawConnection
            .getRepository(AdminNotificationDelivery)
            .findAndCount({ where, order: { createdAt: 'DESC', id: 'DESC' }, skip, take });
        return { items, totalItems };
    }

    status() {
        return this.worker.status();
    }

    async dispatchDue(): Promise<number> {
        return this.worker.dispatchDue();
    }

    async escalateOverdue(): Promise<number> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const overdue = await repository.find({
            where: {
                mode: 'INCIDENT',
                eventState: 'FIRING',
                severity: 'P1',
                actionRequired: true,
                slaDueAt: LessThanOrEqual(new Date()),
                escalatedAt: IsNull(),
                acknowledgedAt: IsNull(),
                deliveryStatus: Not('CLAIMED'),
            },
            take: 100,
        });
        let escalated = 0;
        for (const candidate of overdue) {
            const delivery = await this.inTransaction(null, async txCtx => {
                const txRepository = this.repository(txCtx);
                const current = supportsWriteLock(this.connection.rawConnection.options.type)
                    ? await txRepository
                          .createQueryBuilder('incident')
                          .where('incident.id = :id', { id: candidate.id })
                          .setLock('pessimistic_write')
                          .getOne()
                    : await txRepository.findOne({ where: { id: candidate.id } });
                if (
                    !current ||
                    current.acknowledgedAt ||
                    current.escalatedAt ||
                    current.eventState !== 'FIRING'
                ) {
                    return null;
                }
                const now = new Date();
                current.escalatedAt = now;
                current.escalationDepartmentCode = 'EXEC';
                current.payload = sanitizePayload({
                    ...current.payload,
                    escalated: '已超时升级总经办',
                });
                current.deliveryAction = current.telegramMessageId ? 'EDIT' : 'SEND';
                current.deliveryStatus = 'PENDING';
                current.availableAt = now;
                await txRepository.save(current);
                await this.incidentResponse.appendSystemEvidence(
                    txCtx,
                    current,
                    'ESCALATED',
                    '负责人确认超时，已升级总经办',
                    { stage: 'ACKNOWLEDGEMENT', slaDueAt: current.slaDueAt },
                    now,
                );
                return current;
            });
            if (!delivery) continue;
            escalated += 1;
            await this.worker.dispatch(delivery.id);
        }
        return escalated;
    }

    async sendTest(kind: string): Promise<AdminNotificationDelivery> {
        const normalized = ['NORMAL', 'P0', 'ORDER', 'INVENTORY', 'RESOLVED'].includes(kind)
            ? kind
            : 'NORMAL';
        const input: AdminNotificationInput = {
            eventType:
                normalized === 'ORDER'
                    ? 'commerce.order.placed'
                    : normalized === 'INVENTORY'
                      ? 'inventory.variant.low'
                      : normalized === 'P0'
                        ? 'system.database.down'
                        : 'system.notification.test',
            category: normalized === 'ORDER' ? 'ORDER' : normalized === 'INVENTORY' ? 'INVENTORY' : 'SYSTEM',
            severity:
                normalized === 'P0'
                    ? 'P0'
                    : normalized === 'ORDER'
                      ? 'P3'
                      : normalized === 'INVENTORY'
                        ? 'P1'
                        : 'P2',
            dedupKey: `telegram.test:${normalized}:${Date.now()}`,
            title:
                normalized === 'RESOLVED'
                    ? 'Telegram 恢复通知测试'
                    : normalized === 'P0'
                      ? 'Telegram P0 告警测试'
                      : normalized === 'ORDER'
                        ? '新订单通知测试'
                        : normalized === 'INVENTORY'
                          ? '低库存通知测试'
                          : 'Telegram 内部通知测试',
            payload: {
                test: true,
                source: '管理员连接测试',
                ...(normalized === 'ORDER' ? { orderCode: 'TEST-ORDER', amount: '100.00 MYR' } : {}),
                ...(normalized === 'INVENTORY' ? { sku: 'TEST-SKU', saleableStock: 1, threshold: 2 } : {}),
            },
        };
        const created = await this.enqueue(
            null,
            input,
            'ONE_OFF',
            normalized === 'RESOLVED' ? 'RESOLVED' : 'INFO',
            true,
        );
        if (!created) throw new Error('无法创建测试通知');
        return created;
    }

    definitions() {
        return this.router.definitions();
    }

    private async enqueue(
        ctx: RequestContext | null,
        input: AdminNotificationInput,
        mode: NotificationMode,
        eventState: NotificationEventState,
        force: boolean,
    ): Promise<AdminNotificationDelivery | null> {
        const config = await this.configService.get();
        const shouldDeliver = force ? true : this.shouldEnqueue(config, input);
        if (mode === 'ONE_OFF' && !shouldDeliver) return null;
        if (force && (!config.enabled || !config.tokenConfigured || !config.chatId)) {
            throw new Error('请先启用 Telegram 通知并配置 Bot Token 和 Chat ID');
        }
        const now = input.occurredAt ?? new Date();
        const route = this.router.route(input.eventType, input.severity, config.routeOverrides);
        const override = config.routeOverrides.find(item => item.eventType === input.eventType);
        if (input.severity === 'P1' && override?.slaMinutes === undefined) {
            route.slaMinutes = config.p1EscalationMinutes;
        }
        if (route.fallback) {
            Logger.error(`未注册通知事件 ${input.eventType}，已回退到 EXEC`, LOGGER_CTX);
        }
        const repository = this.repository(ctx);
        const dedupKey = normalizedOptional(input.dedupKey, 255);
        if (dedupKey) {
            const existing = await repository.findOne({ where: { dedupKey } });
            if (existing) return existing;
        }
        const fingerprint = normalizedOptional(input.fingerprint, 255);
        const delivery = new AdminNotificationDelivery({
            eventType: boundedText(input.eventType, 100),
            category: boundedText(input.category, 32),
            ownerDepartmentCode: route.owner,
            collaboratorDepartmentCodes: route.collaborators,
            escalationDepartmentCode: route.escalation,
            actionRequired: route.actionRequired,
            slaDueAt: route.slaMinutes == null ? null : new Date(now.getTime() + route.slaMinutes * 60_000),
            actionHint: route.actionHint,
            severity: input.severity,
            mode,
            eventState,
            sourceType: normalizedOptional(input.sourceType, 64),
            sourceId: normalizedOptional(input.sourceId, 128),
            dedupKey,
            fingerprint,
            activeFingerprint: mode === 'INCIDENT' ? fingerprint : null,
            title: boundedText(input.title, 300),
            occurrenceCount: 1,
            firstOccurredAt: now,
            lastOccurredAt: now,
            resolvedAt: eventState === 'RESOLVED' ? now : null,
            escalatedAt: input.severity === 'P0' ? now : null,
            incidentStatus: (mode === 'INCIDENT' ? 'OPEN' : 'NOT_APPLICABLE') as IncidentStatus,
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            acknowledgementNote: null,
            recoveryObservedAt: null,
            recoveryValidationDueAt: null,
            recoveryValidatedAt: null,
            recoveryValidatedByUserId: null,
            recoveryValidationNote: null,
            recoveryEscalatedAt: null,
            reviewDueAt: null,
            reviewSubmittedAt: null,
            reviewSubmittedByUserId: null,
            rootCause: null,
            impactSummary: null,
            reviewEscalatedAt: null,
            closedAt: null,
            priority: input.priority ?? severityPriority(input.severity),
            silent:
                input.silent ??
                (input.severity === 'P2'
                    ? config.p2Silent
                    : input.severity === 'P3'
                      ? config.p3Silent
                      : false),
            deliveryAction: 'SEND',
            deliveryStatus: shouldDeliver ? 'PENDING' : 'SKIPPED',
            availableAt: now,
            attempts: 0,
            maxAttempts: 6,
            claimedAt: null,
            claimedBy: null,
            telegramMessageId: null,
            queueJobId: null,
            lastErrorCode: null,
            lastError: null,
            sentAt: null,
        });
        delivery.payload = sanitizePayload(input.payload ?? {});
        let saved: AdminNotificationDelivery;
        try {
            saved = await this.inTransaction(ctx, async txCtx => {
                const persisted = await this.repository(txCtx).save(delivery);
                if (mode === 'INCIDENT') {
                    await this.incidentResponse.appendSystemEvidence(
                        txCtx,
                        persisted,
                        'CREATED',
                        '事故记录已创建',
                        {
                            severity: persisted.severity,
                            ownerDepartmentCode: persisted.ownerDepartmentCode,
                            payload: persisted.payload,
                        },
                        now,
                    );
                    if (input.severity === 'P0') {
                        await this.incidentResponse.appendSystemEvidence(
                            txCtx,
                            persisted,
                            'ESCALATED',
                            'P0 事故已立即升级总经办',
                            { stage: 'IMMEDIATE' },
                            now,
                        );
                    }
                }
                return persisted;
            });
        } catch (error) {
            if (dedupKey || fingerprint) {
                const existing = await repository.findOne({
                    where: dedupKey ? { dedupKey } : { activeFingerprint: fingerprint as string },
                });
                if (existing) return existing;
            }
            throw error;
        }
        if (shouldDeliver) await this.worker.dispatch(saved.id);
        return saved;
    }

    private shouldEnqueue(
        config: Awaited<ReturnType<AdminNotificationConfigService['get']>>,
        input: AdminNotificationInput,
    ): boolean {
        if (!config.enabled || !this.configService.shouldDeliver(config, input.severity)) return false;
        if (input.category === 'ORDER') return config.notifyOrderEvents;
        if (input.category === 'PAYMENT') return config.notifyPaymentEvents;
        if (input.category === 'FULFILLMENT') return config.notifyFulfillmentEvents;
        if (input.category === 'REFUND') return config.notifyRefundEvents;
        if (input.category === 'INVENTORY') return config.notifyInventoryEvents;
        return true;
    }

    private repository(ctx: RequestContext | null) {
        return ctx
            ? this.connection.getRepository(ctx, AdminNotificationDelivery)
            : this.connection.rawConnection.getRepository(AdminNotificationDelivery);
    }

    private inTransaction<T>(
        ctx: RequestContext | null,
        work: (transactionContext: RequestContext) => Promise<T>,
    ): Promise<T> {
        return ctx ? this.connection.withTransaction(ctx, work) : this.connection.withTransaction(work);
    }
}

export { sanitizePayload } from './notification-payload';

function severityPriority(severity: NotificationSeverity): number {
    return { P0: 100, P1: 80, P2: 50, P3: 20 }[severity];
}

function supportsWriteLock(type: unknown): boolean {
    return ['mysql', 'mariadb', 'postgres', 'aurora-postgres'].includes(String(type));
}

export function departmentCodesForDelivery(delivery: AdminNotificationDelivery): DepartmentCode[] {
    return [
        delivery.ownerDepartmentCode,
        ...delivery.collaboratorDepartmentCodes,
        ...(delivery.escalationDepartmentCode ? [delivery.escalationDepartmentCode] : []),
    ];
}
