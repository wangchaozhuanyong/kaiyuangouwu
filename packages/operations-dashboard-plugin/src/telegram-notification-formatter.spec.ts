import { describe, expect, it } from 'vitest';

import { sanitizePayload } from './admin-notification.service';
import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { formatTelegramNotification } from './telegram-notification-formatter';

describe('Telegram notification formatting', () => {
    it('escapes dynamic HTML, hides the admin path and adds a safe button', () => {
        const delivery = deliveryFixture({
            title: '<script>alert(1)</script>',
            payload: { orderCode: '<ORDER&1>', adminPath: '/sales/orders/1' },
        });
        const result = formatTelegramNotification(delivery, {
            timezone: 'Asia/Kuala_Lumpur',
            adminBaseUrl: 'https://console.example.com/dashboard',
        });

        expect(result.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(result.text).toContain('&lt;ORDER&amp;1&gt;');
        expect(result.text).not.toContain('adminPath');
        expect(result.button?.url).toBe('https://console.example.com/dashboard/sales/orders/1');
    });

    it('removes secrets and masks email and IP payload values', () => {
        expect(
            sanitizePayload({
                apiKey: 'secret-value',
                customerEmail: 'person@example.com',
                customerIp: '192.168.10.25',
                error: 'line one\nline two',
            }),
        ).toEqual({
            customerEmail: 'pe***@example.com',
            customerIp: '192.168.x.x',
            error: 'line one line two',
        });
    });
});

function deliveryFixture(overrides: Partial<AdminNotificationDelivery>): AdminNotificationDelivery {
    return Object.assign(
        new AdminNotificationDelivery({
            eventType: 'commerce.order.placed',
            category: 'ORDER',
            ownerDepartmentCode: 'SALES',
            collaboratorDepartmentCodes: ['FULFILLMENT'],
            escalationDepartmentCode: null,
            actionRequired: false,
            slaDueAt: null,
            actionHint: '处理订单',
            severity: 'P3',
            mode: 'ONE_OFF',
            eventState: 'INFO',
            sourceType: 'Order',
            sourceId: '1',
            dedupKey: 'order:1',
            fingerprint: null,
            activeFingerprint: null,
            title: '新订单',
            occurrenceCount: 1,
            firstOccurredAt: new Date('2026-09-03T10:00:00Z'),
            lastOccurredAt: new Date('2026-09-03T10:00:00Z'),
            resolvedAt: null,
            escalatedAt: null,
            priority: 20,
            silent: true,
            deliveryAction: 'SEND',
            deliveryStatus: 'PENDING',
            availableAt: new Date('2026-09-03T10:00:00Z'),
            attempts: 0,
            maxAttempts: 6,
            claimedAt: null,
            claimedBy: null,
            telegramMessageId: null,
            queueJobId: null,
            lastErrorCode: null,
            lastError: null,
            sentAt: null,
        }),
        { payload: {}, ...overrides },
    );
}
