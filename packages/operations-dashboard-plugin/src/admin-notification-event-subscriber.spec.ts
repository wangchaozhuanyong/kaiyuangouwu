import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationEventSubscriber } from './admin-notification-event-subscriber';
import { AdminNotificationRequestedEvent } from './admin-notification-requested.event';

describe('AdminNotificationEventSubscriber', () => {
    it('classifies an invalid USDT proof as an immediate P0 finance risk', async () => {
        const enqueueOneOff = vi.fn().mockResolvedValue({ id: 1 });
        const subscriber = new AdminNotificationEventSubscriber(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { enqueueOneOff } as never,
        );

        await (
            subscriber as unknown as {
                onPaymentTransition(event: unknown): Promise<void>;
            }
        ).onPaymentTransition({
            ctx: { channelId: 'channel-1' },
            fromState: 'Created',
            toState: 'Declined',
            payment: {
                id: 'payment-1',
                method: 'usdt-trc20',
                amount: 0,
                errorMessage: 'USDT 链上付款凭证无效或已过期',
            },
            order: {
                id: 'order-1',
                code: 'ORDER-1',
                currencyCode: 'CNY',
                totalWithTax: 10_000,
                customer: { emailAddress: 'person@example.com' },
            },
        });

        expect(enqueueOneOff).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                eventType: 'commerce.payment.proof_mismatch',
                category: 'PAYMENT',
                severity: 'P0',
                dedupKey: 'commerce.payment.proof_mismatch:payment-1',
            }),
        );
    });

    it('routes domain notification requests to incident creation and resolution', async () => {
        const notifications = {
            enqueueOneOff: vi.fn(),
            upsertIncident: vi.fn(),
            resolveIncident: vi.fn(),
        };
        const subscriber = new AdminNotificationEventSubscriber(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            notifications as never,
        );
        const ctx = { channelId: 'channel-1' } as never;
        const base = {
            eventType: 'commerce.fulfillment.auto_card_failed',
            category: 'FULFILLMENT',
            severity: 'P1' as const,
            fingerprint: 'auto-card:1',
            title: '自动发卡失败',
            payload: { deliveryId: '1' },
        };

        await (
            subscriber as unknown as {
                onRequestedNotification(event: AdminNotificationRequestedEvent): Promise<void>;
            }
        ).onRequestedNotification(
            new AdminNotificationRequestedEvent(ctx, { ...base, mode: 'INCIDENT_FIRING' }),
        );
        await (
            subscriber as unknown as {
                onRequestedNotification(event: AdminNotificationRequestedEvent): Promise<void>;
            }
        ).onRequestedNotification(
            new AdminNotificationRequestedEvent(ctx, { ...base, mode: 'INCIDENT_RESOLVED' }),
        );

        expect(notifications.upsertIncident).toHaveBeenCalledWith(ctx, base);
        expect(notifications.resolveIncident).toHaveBeenCalledWith(ctx, 'auto-card:1', {
            deliveryId: '1',
        });
        expect(notifications.enqueueOneOff).not.toHaveBeenCalled();
    });
});
