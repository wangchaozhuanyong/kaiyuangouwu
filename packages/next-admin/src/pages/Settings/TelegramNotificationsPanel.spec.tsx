import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TelegramNotificationsResult } from '../../graphql/telegram-notifications.graphql';

import { TelegramNotificationsPanel } from './TelegramNotificationsPanel';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

const departmentCodes = [
    'EXEC',
    'INTEL',
    'PRODUCT',
    'SUPPLY',
    'DESIGN',
    'CONTENT',
    'GROWTH',
    'SALES',
    'FULFILLMENT',
    'TECH',
    'DATA_FINANCE',
    'GOVERNANCE',
];

const result: TelegramNotificationsResult = {
    telegramNotificationConfig: {
        id: '1',
        enabled: true,
        tokenConfigured: true,
        chatId: '-1001',
        chatIdSource: 'ENVIRONMENT',
        adminBaseUrl: 'https://console.example.com/dashboard',
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
        botUsername: 'internal_bot',
        lastConnectionAt: '2026-09-03T10:00:00.000Z',
        lastConnectionError: null,
    },
    telegramNotificationStatus: {
        running: true,
        processed: 12,
        failures: 1,
        pending: 2,
        retrying: 1,
        dead: 1,
        oldestLagSeconds: 90,
        lastSuccessAt: '2026-09-03T10:00:00.000Z',
        lastErrorAt: null,
        lastError: null,
    },
    telegramNotificationConfigAudits: [
        {
            id: 'audit-1',
            createdAt: '2026-09-03T10:00:00.000Z',
            action: 'UPDATED',
            actorUserId: 'admin-1',
            changes: { enabled: { before: false, after: true } },
        },
    ],
    telegramNotificationDeliveries: {
        totalItems: 1,
        items: [
            {
                id: '9',
                createdAt: '2026-09-03T10:00:00.000Z',
                eventType: 'system.database.down',
                category: 'SYSTEM',
                ownerDepartmentCode: 'TECH',
                collaboratorDepartmentCodes: ['DATA_FINANCE', 'GOVERNANCE'],
                escalationDepartmentCode: 'EXEC',
                actionRequired: true,
                slaDueAt: '2026-09-03T10:00:00.000Z',
                severity: 'P0',
                eventState: 'FIRING',
                title: '数据库连接中断',
                occurrenceCount: 2,
                deliveryStatus: 'DEAD',
                attempts: 6,
                maxAttempts: 6,
                telegramMessageId: null,
                lastErrorCode: 'AUTHORIZATION',
                lastError: 'Telegram 群权限无效',
                sentAt: null,
            },
        ],
    },
    telegramDepartmentRouting: {
        departments: departmentCodes.map(code => ({ code, nameZh: code + ' 部门', nameEn: code })),
        routes: [
            {
                eventType: 'system.database.down',
                severity: 'P0',
                owner: 'TECH',
                collaborators: ['DATA_FINANCE', 'GOVERNANCE'],
                escalation: 'EXEC',
                actionRequired: true,
                slaMinutes: 0,
                actionHint: '立即检查数据库',
                overridden: false,
                defaultOwner: 'TECH',
                defaultCollaborators: ['DATA_FINANCE', 'GOVERNANCE'],
                defaultEscalation: 'EXEC',
                defaultActionRequired: true,
                defaultSlaMinutes: 0,
            },
        ],
    },
};

describe('TelegramNotificationsPanel', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: result,
            error: undefined,
            loading: false,
            refetch: vi.fn(),
        });
    });

    it('shows configuration, worker health, twelve departments and dead-letter retry', () => {
        const html = renderToStaticMarkup(<TelegramNotificationsPanel />);

        expect(html).toContain('Telegram 连接与策略');
        expect(html).toContain('12 成功 · 1 失败');
        expect(html).toContain('system.database.down');
        expect(html).toContain('GOVERNANCE · GOVERNANCE 部门');
        expect(html).toContain('配置变更审计');
        expect(html).toContain('修改字段：enabled');
        expect(html).toContain('重试');
    });

    it('keeps P0 escalation and action controls locked', () => {
        const html = renderToStaticMarkup(<TelegramNotificationsPanel />);

        expect(html).toMatch(/aria-label="system\.database\.down 升级部门"[^>]*disabled/u);
        expect(html).toMatch(/aria-label="system\.database\.down 需要处理"[^>]*disabled/u);
    });
});
