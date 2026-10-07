// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
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
        notifyOnlineReports: true,
        notifyServiceReviews: true,
        notifyPromotionExpiry: true,
        notifyAiCredentials: true,
        notifySecurityEvents: true,
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
    adminIncidents: {
        totalItems: 1,
        items: [
            {
                id: '9',
                createdAt: '2026-09-03T10:00:00.000Z',
                updatedAt: '2026-09-03T10:05:00.000Z',
                eventType: 'system.database.down',
                category: 'SYSTEM',
                ownerDepartmentCode: 'TECH',
                collaboratorDepartmentCodes: ['DATA_FINANCE', 'GOVERNANCE'],
                escalationDepartmentCode: 'EXEC',
                severity: 'P0',
                eventState: 'FIRING',
                title: '数据库连接中断',
                occurrenceCount: 2,
                firstOccurredAt: '2026-09-03T10:00:00.000Z',
                lastOccurredAt: '2026-09-03T10:05:00.000Z',
                resolvedAt: null,
                incidentStatus: 'OPEN',
                acknowledgedAt: null,
                acknowledgementNote: null,
                recoveryObservedAt: null,
                recoveryValidationDueAt: null,
                recoveryValidatedAt: null,
                recoveryValidationNote: null,
                reviewDueAt: null,
                reviewSubmittedAt: null,
                rootCause: null,
                impactSummary: null,
                closedAt: null,
                actions: [],
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
        const html = renderPanel();

        expect(html).toContain('Telegram 连接与策略');
        expect(html).toContain('12 成功 · 1 失败');
        expect(html).toContain('数据库连接中断');
        expect(html).toContain('GOVERNANCE 部门');
        expect(html).not.toContain('>GOVERNANCE<');
        expect(html).toContain('配置变更审计');
        expect(html).toContain('事故响应与闭环');
        expect(html).toContain('确认接手');
        expect(html).toContain('data-label="修改字段"');
        expect(html).toContain('通知总开关');
        expect(html).toContain('重试');
    });

    it('renders independent notification fields and preserves all six sections', () => {
        const html = renderPanel();
        expect(html).toContain('aria-label="消息通知分区"');
        expect(html).toContain('data-label="通知标题"');
        expect(html).toContain('data-label="事件"');
        expect(html).toContain('data-label="已尝试次数"');
        expect(html).toContain('data-label="最多尝试次数"');
        expect(html).not.toContain('data-label="通知"');
        expect(html).not.toContain('data-label="尝试"');
        expect(html).toContain('data-label="事故状态"');
        expect(html).toContain('data-label="发生次数"');
        expect((html.match(/<section hidden=""/g) ?? []).length).toBe(5);
    });

    it('keeps a configuration draft when switching sections without issuing writes', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const mutation = vi.fn();
        apolloMocks.useMutation.mockReturnValue([mutation, { loading: false }]);
        try {
            await act(async () =>
                root.render(
                    <FeatureHelpProvider>
                        <TelegramNotificationsPanel />
                    </FeatureHelpProvider>,
                ),
            );
            const input = container.querySelector<HTMLInputElement>(
                'input[placeholder="https://console.example.com/dashboard"]',
            )!;
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                    input,
                    'https://draft.example.com/dashboard',
                );
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            const tab = (text: string) =>
                Array.from(container.querySelectorAll<HTMLButtonElement>('nav button')).find(
                    node => node.textContent === text,
                )!;
            await act(async () => tab('部门路由').click());
            expect(input.closest('section')?.hidden).toBe(true);
            await act(async () => tab('连接与策略').click());
            expect(input.closest('section')?.hidden).toBe(false);
            expect(input.value).toBe('https://draft.example.com/dashboard');
            expect(mutation).not.toHaveBeenCalled();
        } finally {
            await act(async () => root.unmount());
            container.remove();
            (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
        }
    });

    it('keeps P0 escalation and action controls locked', () => {
        const html = renderPanel();

        expect(html).toMatch(/aria-label="数据库连接失败 升级部门"[^>]*disabled/u);
        expect(html).toMatch(/aria-label="数据库连接失败 需要处理"[^>]*disabled/u);
    });
});

function renderPanel(): string {
    return renderToStaticMarkup(
        <FeatureHelpProvider>
            <TelegramNotificationsPanel />
        </FeatureHelpProvider>,
    );
}

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
