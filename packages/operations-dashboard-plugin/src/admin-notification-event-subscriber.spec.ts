import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationEventSubscriber } from './admin-notification-event-subscriber';
import { AdminNotificationRequestedEvent } from './admin-notification-requested.event';

describe('AdminNotificationEventSubscriber', () => {
    it('uses the actual order sales channel instead of the superadmin management channel', async () => {
        const enqueueOneOff = vi.fn();
        const subscriber = new AdminNotificationEventSubscriber(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { enqueueOneOff } as never,
        );
        await (subscriber as any).onOrderPlaced({
            ctx: { channelId: 1 },
            order: {
                id: 11,
                code: 'ORDER-A',
                salesChannelId: 2,
                state: 'PaymentSettled',
                currencyCode: 'CNY',
                totalWithTax: 5000,
                lines: [],
            },
        });
        expect(enqueueOneOff).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ silent: false, payload: expect.objectContaining({ channelId: '2' }) }),
        );
    });

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

    it('checks every sales channel, excludes the management channel and resolves infinite or replenished stock', async () => {
        const notifications = { upsertIncident: vi.fn(), resolveIncident: vi.fn() };
        let stock = 0;
        const getSaleableStockLevel = vi.fn((ctx: { channelId: number }) =>
            Promise.resolve(ctx.channelId === 3 ? Number.MAX_SAFE_INTEGER : stock),
        );
        const subscriber = new AdminNotificationEventSubscriber(
            {} as never,
            {
                getEntityOrThrow: () =>
                    Promise.resolve({
                        id: 11,
                        productId: 7,
                        sku: 'SKU-11',
                        channels: [
                            { id: 1, code: '__default_channel__' },
                            { id: 2, code: 'shop-a' },
                            { id: 3, code: 'shop-b' },
                        ],
                    }),
                rawConnection: {
                    hasMetadata: () => true,
                    getRepository: () => ({ findOne: () => Promise.resolve(null) }),
                },
            } as never,
            { getSaleableStockLevel } as never,
            {
                get: () =>
                    Promise.resolve({ enabled: true, notifyInventoryEvents: true, inventoryLowThreshold: 2 }),
            } as never,
            notifications as never,
            {
                create: ({ channelOrToken }: { channelOrToken: { id: number } }) =>
                    Promise.resolve({
                        channelId: channelOrToken.id,
                    }),
            } as never,
        );
        const run = () =>
            (subscriber as unknown as { onStockMovement(event: unknown): Promise<void> }).onStockMovement({
                ctx: { channelId: 1 },
                stockMovements: [{ productVariant: { id: 11 } }],
            });
        await run();
        expect(getSaleableStockLevel).toHaveBeenCalledTimes(2);
        expect(notifications.upsertIncident).toHaveBeenCalledWith(
            { channelId: 2 },
            expect.objectContaining({
                severity: 'P0',
                fingerprint: 'inventory.variant.low:2:11',
                payload: expect.objectContaining({ channelId: '2', saleableStock: 0 }),
            }),
        );
        expect(notifications.resolveIncident).toHaveBeenCalledWith(
            { channelId: 3 },
            'inventory.variant.low:3:11',
            expect.anything(),
        );
        notifications.upsertIncident.mockClear();
        stock = 5;
        await run();
        expect(notifications.upsertIncident).not.toHaveBeenCalled();
        expect(notifications.resolveIncident).toHaveBeenCalledWith(
            { channelId: 2 },
            'inventory.variant.low:2:11',
            expect.objectContaining({ saleableStock: 5 }),
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
