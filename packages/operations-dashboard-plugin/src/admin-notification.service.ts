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
    NotificationDeliveryStatus,
    NotificationEventState,
    NotificationMode,
} from './entities/admin-notification-delivery.entity';
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
    ) {}

    async enqueueOneOff(ctx: RequestContext | null, input: AdminNotificationInput, force = false) {
        return this.enqueue(ctx, input, 'ONE_OFF', 'INFO', force);
    }

    async upsertIncident(ctx: RequestContext | null, input: AdminNotificationInput, force = false) {
        if (!input.fingerprint?.trim()) throw new Error('持续事件必须提供 fingerprint');
        const config = await this.configService.get();
        if (!force && !this.shouldEnqueue(config, input)) return null;
        const repository = this.repository(ctx);
        const fingerprint = boundedText(input.fingerprint, 255);
        const existing = await repository.findOne({ where: { activeFingerprint: fingerprint } });
        if (!existing) return this.enqueue(ctx, input, 'INCIDENT', 'FIRING', force);
        const now = input.occurredAt ?? new Date();
        existing.occurrenceCount += 1;
        existing.lastOccurredAt = now;
        existing.payload = sanitizePayload(input.payload ?? {});
        existing.title = boundedText(input.title, 300);
        existing.severity = input.severity;
        const repeatMinutes = input.severity === 'P0' ? config.p0RepeatMinutes : config.p1RepeatMinutes;
        const repeatDue =
            (input.severity === 'P0' || input.severity === 'P1') &&
            (!existing.sentAt || now.getTime() - existing.sentAt.getTime() >= repeatMinutes * 60_000);
        if (repeatDue) {
            existing.deliveryAction = existing.telegramMessageId ? 'EDIT' : 'SEND';
            existing.deliveryStatus = 'PENDING';
            existing.availableAt = now;
            existing.claimedAt = null;
            existing.claimedBy = null;
        }
        await repository.save(existing);
        if (repeatDue) await this.worker.dispatch(existing.id);
        return existing;
    }

    async resolveIncident(
        ctx: RequestContext | null,
        fingerprint: string,
        payload: Record<string, unknown> = {},
    ) {
        const config = await this.configService.get();
        const repository = this.repository(ctx);
        const delivery = await repository.findOne({
            where: { activeFingerprint: boundedText(fingerprint, 255) },
        });
        if (!delivery) return null;
        const resolvedAt = new Date();
        delivery.activeFingerprint = null;
        delivery.eventState = 'RESOLVED';
        delivery.resolvedAt = resolvedAt;
        delivery.lastOccurredAt = resolvedAt;
        delivery.payload = sanitizePayload({ ...delivery.payload, ...payload });
        delivery.deliveryAction = delivery.telegramMessageId ? 'EDIT' : 'SEND';
        delivery.deliveryStatus = config.sendResolved && config.enabled ? 'PENDING' : 'SKIPPED';
        delivery.availableAt = resolvedAt;
        delivery.silent = true;
        delivery.claimedAt = null;
        delivery.claimedBy = null;
        await repository.save(delivery);
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
                deliveryStatus: Not('CLAIMED'),
            },
            take: 100,
        });
        for (const delivery of overdue) {
            delivery.escalatedAt = new Date();
            delivery.escalationDepartmentCode = 'EXEC';
            delivery.payload = sanitizePayload({ ...delivery.payload, escalated: '已超时升级总经办' });
            delivery.deliveryAction = delivery.telegramMessageId ? 'EDIT' : 'SEND';
            delivery.deliveryStatus = 'PENDING';
            delivery.availableAt = new Date();
            await repository.save(delivery);
            await this.worker.dispatch(delivery.id);
        }
        return overdue.length;
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
        if (!force && !this.shouldEnqueue(config, input)) return null;
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
            priority: input.priority ?? severityPriority(input.severity),
            silent:
                input.silent ??
                (input.severity === 'P2'
                    ? config.p2Silent
                    : input.severity === 'P3'
                      ? config.p3Silent
                      : false),
            deliveryAction: 'SEND',
            deliveryStatus: 'PENDING',
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
        try {
            const saved = await repository.save(delivery);
            await this.worker.dispatch(saved.id);
            return saved;
        } catch (error) {
            if (dedupKey || fingerprint) {
                const existing = await repository.findOne({
                    where: dedupKey ? { dedupKey } : { activeFingerprint: fingerprint as string },
                });
                if (existing) return existing;
            }
            throw error;
        }
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
}

export function sanitizePayload(input: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(input).slice(0, 40)) {
        const key = boundedText(rawKey, 64);
        if (/token|secret|password|authorization|cookie|credential|private.?key|api.?key/iu.test(key))
            continue;
        output[key] = sanitizeValue(key, rawValue);
    }
    return output;
}

function sanitizeValue(key: string, value: unknown): unknown {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(key, item));
    if (typeof value === 'object') return '[object omitted]';
    if (typeof value !== 'string') return `[${typeof value} omitted]`;
    let text = value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (/email/iu.test(key)) text = maskEmail(text);
    if (/ip/iu.test(key)) text = maskIp(text);
    return text.slice(0, /error|message|reason/iu.test(key) ? 500 : 300);
}

function maskEmail(value: string): string {
    const match = /^([^@]+)@(.+)$/u.exec(value);
    if (!match) return value.slice(0, 3) + '***';
    const local = match[1];
    return `${local.slice(0, Math.min(2, local.length))}***@${match[2]}`;
}

function maskIp(value: string): string {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return value.replace(/\.\d{1,3}\.\d{1,3}$/u, '.x.x');
    return value.slice(0, 8) + '…';
}

function boundedText(value: unknown, length: number): string {
    const scalar =
        value == null
            ? ''
            : typeof value === 'string'
              ? value
              : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
                ? String(value)
                : '';
    return scalar
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .trim()
        .slice(0, length);
}

function normalizedOptional(value: unknown, length: number): string | null {
    const normalized = boundedText(value, length);
    return normalized || null;
}

function severityPriority(severity: NotificationSeverity): number {
    return { P0: 100, P1: 80, P2: 50, P3: 20 }[severity];
}

export function departmentCodesForDelivery(delivery: AdminNotificationDelivery): DepartmentCode[] {
    return [
        delivery.ownerDepartmentCode,
        ...delivery.collaboratorDepartmentCodes,
        ...(delivery.escalationDepartmentCode ? [delivery.escalationDepartmentCode] : []),
    ];
}
