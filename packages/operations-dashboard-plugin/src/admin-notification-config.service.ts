import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';

import {
    departmentCodes,
    DepartmentNotificationRouter,
    isDepartmentCode,
    NotificationSeverity,
    validateRouteOverrides,
} from './department-notification-router';
import {
    AdminNotificationConfigAudit,
    AdminNotificationConfigChange,
} from './entities/admin-notification-config-audit.entity';
import { AdminNotificationConfig } from './entities/admin-notification-config.entity';
import { TelegramClient } from './telegram-client';

const CONFIG_KEY = 'telegram-internal';
const severityOrder: NotificationSeverity[] = ['P0', 'P1', 'P2', 'P3'];

export interface UpdateAdminNotificationConfigInput {
    enabled?: boolean;
    chatId?: string | null;
    adminBaseUrl?: string | null;
    timezone?: string;
    minSeverity?: NotificationSeverity;
    sendResolved?: boolean;
    p2Silent?: boolean;
    p3Silent?: boolean;
    notifyOrderEvents?: boolean;
    notifyPaymentEvents?: boolean;
    notifyFulfillmentEvents?: boolean;
    notifyRefundEvents?: boolean;
    notifyInventoryEvents?: boolean;
    inventoryLowThreshold?: number;
    p1EscalationMinutes?: number;
    p0RepeatMinutes?: number;
    p1RepeatMinutes?: number;
    departmentMentions?: Record<string, string> | null;
    routeOverrides?: unknown;
}

export interface AdminNotificationRuntimeConfig {
    id: string;
    enabled: boolean;
    tokenConfigured: boolean;
    chatId: string | null;
    chatIdSource: 'ENVIRONMENT' | 'DATABASE' | 'NONE';
    adminBaseUrl: string | null;
    timezone: string;
    minSeverity: NotificationSeverity;
    sendResolved: boolean;
    p2Silent: boolean;
    p3Silent: boolean;
    notifyOrderEvents: boolean;
    notifyPaymentEvents: boolean;
    notifyFulfillmentEvents: boolean;
    notifyRefundEvents: boolean;
    notifyInventoryEvents: boolean;
    inventoryLowThreshold: number;
    p1EscalationMinutes: number;
    p0RepeatMinutes: number;
    p1RepeatMinutes: number;
    departmentMentions: Record<string, string>;
    routeOverrides: ReturnType<typeof validateRouteOverrides>;
    botUsername: string | null;
    lastConnectionAt: Date | null;
    lastConnectionError: string | null;
}

@Injectable()
export class AdminNotificationConfigService {
    private cached: AdminNotificationRuntimeConfig | null = null;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly telegram: TelegramClient,
    ) {}

    async get(): Promise<AdminNotificationRuntimeConfig> {
        const entity = await this.getOrCreate();
        const environmentChatId = normalizedChatId(process.env.TELEGRAM_OPS_CHAT_ID);
        const chatId = environmentChatId ?? normalizedChatId(entity.chatId);
        this.cached = {
            id: String(entity.id),
            enabled: entity.enabled,
            tokenConfigured: this.telegram.configured(),
            chatId,
            chatIdSource: environmentChatId ? 'ENVIRONMENT' : chatId ? 'DATABASE' : 'NONE',
            adminBaseUrl: entity.adminBaseUrl,
            timezone: entity.timezone,
            minSeverity: entity.minSeverity,
            sendResolved: entity.sendResolved,
            p2Silent: entity.p2Silent,
            p3Silent: entity.p3Silent,
            notifyOrderEvents: entity.notifyOrderEvents,
            notifyPaymentEvents: entity.notifyPaymentEvents,
            notifyFulfillmentEvents: entity.notifyFulfillmentEvents,
            notifyRefundEvents: entity.notifyRefundEvents,
            notifyInventoryEvents: entity.notifyInventoryEvents,
            inventoryLowThreshold: entity.inventoryLowThreshold,
            p1EscalationMinutes: entity.p1EscalationMinutes,
            p0RepeatMinutes: entity.p0RepeatMinutes,
            p1RepeatMinutes: entity.p1RepeatMinutes,
            departmentMentions: entity.departmentMentions ?? {},
            routeOverrides: entity.routeOverrides ?? [],
            botUsername: entity.botUsername,
            lastConnectionAt: entity.lastConnectionAt,
            lastConnectionError: entity.lastConnectionError,
        };
        return this.cached;
    }

    cachedConfig(): AdminNotificationRuntimeConfig | null {
        return this.cached;
    }

    async update(
        input: UpdateAdminNotificationConfigInput,
        actorUserId: string | number | null = null,
    ): Promise<AdminNotificationRuntimeConfig> {
        const entity = await this.getOrCreate();
        const before = auditSnapshot(entity);
        if (input.enabled !== undefined) entity.enabled = input.enabled;
        if (input.chatId !== undefined) entity.chatId = normalizedChatId(input.chatId);
        if (input.adminBaseUrl !== undefined) entity.adminBaseUrl = validateAdminBaseUrl(input.adminBaseUrl);
        if (input.timezone !== undefined) entity.timezone = validateTimezone(input.timezone);
        if (input.minSeverity !== undefined) entity.minSeverity = validateSeverity(input.minSeverity);
        for (const key of [
            'sendResolved',
            'p2Silent',
            'p3Silent',
            'notifyOrderEvents',
            'notifyPaymentEvents',
            'notifyFulfillmentEvents',
            'notifyRefundEvents',
            'notifyInventoryEvents',
        ] as const) {
            if (input[key] !== undefined) entity[key] = input[key];
        }
        if (input.inventoryLowThreshold !== undefined) {
            entity.inventoryLowThreshold = boundedInteger(
                input.inventoryLowThreshold,
                0,
                1_000_000,
                '库存阈值',
            );
        }
        if (input.p1EscalationMinutes !== undefined) {
            entity.p1EscalationMinutes = boundedInteger(input.p1EscalationMinutes, 1, 10_080, 'P1 升级时间');
        }
        if (input.p0RepeatMinutes !== undefined) {
            entity.p0RepeatMinutes = boundedInteger(input.p0RepeatMinutes, 1, 1_440, 'P0 重复提醒');
        }
        if (input.p1RepeatMinutes !== undefined) {
            entity.p1RepeatMinutes = boundedInteger(input.p1RepeatMinutes, 1, 10_080, 'P1 重复提醒');
        }
        if (input.departmentMentions !== undefined) {
            entity.departmentMentions = validateMentions(input.departmentMentions);
        }
        if (input.routeOverrides !== undefined) {
            const overrides = validateRouteOverrides(input.routeOverrides);
            const p0Events = new Set(
                new DepartmentNotificationRouter()
                    .definitions()
                    .filter(item => item.severity === 'P0')
                    .map(item => item.eventType),
            );
            if (
                overrides.some(
                    override =>
                        p0Events.has(override.eventType) &&
                        override.escalation !== undefined &&
                        override.escalation !== 'EXEC',
                )
            ) {
                throw new Error('P0 事件不能取消 EXEC 升级');
            }
            entity.routeOverrides = overrides;
        }
        const changes = changedFields(before, auditSnapshot(entity));
        if (Object.keys(changes).length) {
            await this.connection.rawConnection.transaction(async manager => {
                await manager.getRepository(AdminNotificationConfig).save(entity);
                const audit = new AdminNotificationConfigAudit({
                    action: 'UPDATED',
                    actorUserId: actorUserId == null ? null : String(actorUserId),
                });
                audit.changes = changes;
                await manager.getRepository(AdminNotificationConfigAudit).save(audit);
            });
        }
        return this.get();
    }

    listAudits(take?: number | null): Promise<AdminNotificationConfigAudit[]> {
        const limit = Math.min(100, Math.max(1, Math.trunc(take ?? 20)));
        return this.connection.rawConnection.getRepository(AdminNotificationConfigAudit).find({
            order: { createdAt: 'DESC', id: 'DESC' },
            take: limit,
        });
    }

    async testConnection(): Promise<{
        ok: boolean;
        message: string;
        botUsername: string | null;
        testedAt: Date;
    }> {
        const entity = await this.getOrCreate();
        const testedAt = new Date();
        try {
            const identity = await this.telegram.getMe();
            entity.botUsername = identity.username;
            entity.lastConnectionAt = testedAt;
            entity.lastConnectionError = null;
            await this.connection.rawConnection.getRepository(AdminNotificationConfig).save(entity);
            await this.get();
            return {
                ok: true,
                message: `Bot ${identity.username ? `@${identity.username}` : identity.displayName} 连接正常`,
                botUsername: identity.username,
                testedAt,
            };
        } catch (error) {
            const message = safeError(error);
            entity.lastConnectionAt = testedAt;
            entity.lastConnectionError = message;
            await this.connection.rawConnection.getRepository(AdminNotificationConfig).save(entity);
            await this.get();
            return { ok: false, message, botUsername: entity.botUsername, testedAt };
        }
    }

    shouldDeliver(config: AdminNotificationRuntimeConfig, severity: NotificationSeverity): boolean {
        return severityOrder.indexOf(severity) <= severityOrder.indexOf(config.minSeverity);
    }

    private async getOrCreate(): Promise<AdminNotificationConfig> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationConfig);
        const existing = await repository.findOne({ where: { key: CONFIG_KEY } });
        if (existing) return existing;
        try {
            return await repository.save(
                new AdminNotificationConfig({
                    key: CONFIG_KEY,
                    enabled: false,
                    chatId: null,
                    adminBaseUrl: process.env.VENDURE_DASHBOARD_URL?.trim() || null,
                    timezone: 'Asia/Kuala_Lumpur',
                    minSeverity: 'P3',
                    sendResolved: true,
                    p2Silent: true,
                    p3Silent: true,
                    notifyOrderEvents: true,
                    notifyPaymentEvents: true,
                    notifyFulfillmentEvents: true,
                    notifyRefundEvents: true,
                    notifyInventoryEvents: true,
                    inventoryLowThreshold: 2,
                    p1EscalationMinutes: 60,
                    p0RepeatMinutes: 30,
                    p1RepeatMinutes: 120,
                    departmentMentions: {},
                    routeOverrides: [],
                    botUsername: null,
                    lastConnectionAt: null,
                    lastConnectionError: null,
                }),
            );
        } catch {
            const concurrent = await repository.findOne({ where: { key: CONFIG_KEY } });
            if (concurrent) return concurrent;
            throw new Error('无法初始化 Telegram 通知配置');
        }
    }
}

function normalizedChatId(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('Telegram Chat ID 必须是数字字符串');
    }
    const normalized = String(value).trim();
    if (!normalized) return null;
    if (!/^-?\d{1,32}$/u.test(normalized)) throw new Error('Telegram Chat ID 必须是数字字符串');
    return normalized;
}

function validateAdminBaseUrl(value: string | null): string | null {
    const normalized = value?.trim();
    if (!normalized) return null;
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('管理后台地址必须使用 HTTP 或 HTTPS');
    url.pathname = url.pathname.replace(/\/$/u, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
}

function validateTimezone(value: string): string {
    const normalized = value.trim();
    try {
        new Intl.DateTimeFormat('en', { timeZone: normalized }).format();
    } catch {
        throw new Error('时区名称无效');
    }
    return normalized;
}

function validateSeverity(value: string): NotificationSeverity {
    if (!severityOrder.includes(value as NotificationSeverity)) throw new Error('最低通知等级无效');
    return value as NotificationSeverity;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`);
    }
    return value;
}

function validateMentions(value: Record<string, string> | null): Record<string, string> {
    if (!value) return {};
    const result: Record<string, string> = {};
    for (const [code, mention] of Object.entries(value)) {
        if (!isDepartmentCode(code)) throw new Error(`未知部门编码：${code}`);
        const normalized = mention.trim();
        if (!normalized) continue;
        if (!/^@[A-Za-z0-9_]{5,32}$|^-?\d{1,32}$/u.test(normalized)) {
            throw new Error(`${code} 的 Telegram 提及对象无效`);
        }
        result[code] = normalized;
    }
    return result;
}

function safeError(error: unknown): string {
    const value = error instanceof Error ? error.message : String(error);
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    return value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(token ? new RegExp(escapeRegExp(token), 'gu') : /$^/u, '[REDACTED]')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}

function auditSnapshot(entity: AdminNotificationConfig): Record<string, unknown> {
    return {
        enabled: entity.enabled,
        chatId: maskedChatId(entity.chatId),
        adminBaseUrl: entity.adminBaseUrl,
        timezone: entity.timezone,
        minSeverity: entity.minSeverity,
        sendResolved: entity.sendResolved,
        p2Silent: entity.p2Silent,
        p3Silent: entity.p3Silent,
        notifyOrderEvents: entity.notifyOrderEvents,
        notifyPaymentEvents: entity.notifyPaymentEvents,
        notifyFulfillmentEvents: entity.notifyFulfillmentEvents,
        notifyRefundEvents: entity.notifyRefundEvents,
        notifyInventoryEvents: entity.notifyInventoryEvents,
        inventoryLowThreshold: entity.inventoryLowThreshold,
        p1EscalationMinutes: entity.p1EscalationMinutes,
        p0RepeatMinutes: entity.p0RepeatMinutes,
        p1RepeatMinutes: entity.p1RepeatMinutes,
        departmentMentions: entity.departmentMentions ?? {},
        routeOverrides: entity.routeOverrides ?? [],
    };
}

function changedFields(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): Record<string, AdminNotificationConfigChange> {
    const changes: Record<string, AdminNotificationConfigChange> = {};
    for (const key of Object.keys(after)) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
            changes[key] = { before: before[key], after: after[key] };
        }
    }
    return changes;
}

function maskedChatId(value: string | null): string | null {
    const normalized = value?.trim();
    if (!normalized) return null;
    return `${normalized.startsWith('-') ? '-' : ''}***${normalized.replace(/^-?/u, '').slice(-4)}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export { departmentCodes };
