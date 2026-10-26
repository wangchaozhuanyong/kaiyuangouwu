import { describe, expect, it, vi } from 'vitest';

import { createManualDeliveryEmailGuard } from './manual-delivery-email-guard';
vi.mock('@vendure/commerce-fulfillment-plugin', () => ({
    AutoCardService: class AutoCardService {},
    ManualDigitalDeliveryService: class ManualDigitalDeliveryService {},
    OrderConfirmationTokenService: class OrderConfirmationTokenService {},
}));
function fixture(type = 'manual-digital-delivery') {
    const current = {
        recipientEmail: 'fixture@example.invalid',
        orderCode: 'SYNTHETIC-1',
        orderId: 'order-1',
    };
    const queuedEmailPayload = vi.fn().mockResolvedValue(current);
    const notificationPayload = vi.fn().mockResolvedValue(current);
    const verifyToken = vi.fn().mockReturnValue({ orderId: 'order-1', channelId: 'channel-1' });
    const injector = { get: () => ({ queuedEmailPayload, notificationPayload, verifyToken }) } as any;
    const email: any = {
        type,
        recipient: current.recipientEmail,
        metadata: { deliveryId: 'delivery-1' },
        attachments: [],
        templateVars: {
            deliveryId: 'delivery-1',
            receiptUrl: 'https://shop.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof',
        },
    };
    return {
        current,
        queuedEmailPayload,
        notificationPayload,
        verifyToken,
        injector,
        email,
        ctx: { channelId: 'channel-1' } as any,
        guard: createManualDeliveryEmailGuard(() => Promise.resolve('https://shop.example.invalid')),
    };
}
describe('Safe digital notification send-time authorization', () => {
    it.each(['manual-digital-delivery', 'auto-card-delivery'])(
        'accepts a current safe %s entry',
        async type => {
            const f = fixture(type);
            await expect(f.guard(f.injector, f.ctx, f.email)).resolves.toBeUndefined();
            expect(f.queuedEmailPayload).toHaveBeenCalledWith(f.ctx, 'delivery-1');
            expect(f.notificationPayload).not.toHaveBeenCalled();
        },
    );
    it.each(['packages', 'credentials', 'attachments'])(
        'rejects a legacy plaintext %s queue even when empty',
        async field => {
            const f = fixture();
            f.email.templateVars[field] = [];
            await expect(f.guard(f.injector, f.ctx, f.email)).rejects.toThrow('旧明文');
            expect(f.queuedEmailPayload).not.toHaveBeenCalled();
        },
    );
    it.each(['recipient', 'attachment', 'identifier', 'cc', 'bcc'])('rejects changed %s', async kind => {
        const f = fixture();
        if (kind === 'recipient') f.email.recipient = 'other@example.invalid';
        if (kind === 'attachment')
            f.email.attachments = [{ filename: 'dummy.txt', content: 'dummy-private' }];
        if (kind === 'identifier') f.email.metadata.deliveryId = 'other-delivery';
        if (kind === 'cc' || kind === 'bcc') f.email[kind] = 'other@example.invalid';
        await expect(f.guard(f.injector, f.ctx, f.email)).rejects.toThrow();
    });
    it.each([
        'https://other.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof',
        'http://shop.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof',
        'https://shop.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof#other',
        'https://shop.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof&token=second',
        'https://shop.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof&redirect=other',
        'https://shop.example.invalid/other?id=SYNTHETIC-1&token=dummy-proof',
        'https://shop.example.invalid/order-confirmation?id=OTHER&token=dummy-proof',
        'https://user:dummy@shop.example.invalid/order-confirmation?id=SYNTHETIC-1&token=dummy-proof',
        'invalid-url',
    ])('rejects an invalid receipt URL: %s', async receiptUrl => {
        const f = fixture();
        f.email.templateVars.receiptUrl = receiptUrl;
        await expect(f.guard(f.injector, f.ctx, f.email)).rejects.toThrow();
    });
    it.each([
        null,
        { orderId: 'other-order', channelId: 'channel-1' },
        { orderId: 'order-1', channelId: 'other-channel' },
    ])('rejects expired or mismatched proof', async proof => {
        const f = fixture();
        f.verifyToken.mockReturnValue(proof);
        await expect(f.guard(f.injector, f.ctx, f.email)).rejects.toThrow();
    });
    it('propagates a revoked entitlement before transport', async () => {
        const f = fixture();
        f.queuedEmailPayload.mockRejectedValue(new Error('synthetic revoked grant'));
        await expect(f.guard(f.injector, f.ctx, f.email)).rejects.toThrow('revoked grant');
    });
    it.each(['email-verification', 'password-reset', 'email-address-change'])(
        'leaves %s unchanged',
        async type => {
            const f = fixture(type);
            await f.guard(f.injector, f.ctx, f.email);
            expect(f.queuedEmailPayload).not.toHaveBeenCalled();
            expect(f.notificationPayload).not.toHaveBeenCalled();
        },
    );
    it('consumes an old order confirmation without resolving delivery data', async () => {
        const f = fixture('order-confirmation');
        await expect(f.guard(f.injector, f.ctx, f.email)).resolves.toBe(false);
        expect(f.queuedEmailPayload).not.toHaveBeenCalled();
        expect(f.verifyToken).not.toHaveBeenCalled();
    });
    it.each(['manual-digital-delivery', 'auto-card-delivery'])(
        'skips a no-longer-ready %s without attempting transport',
        async type => {
            const f = fixture(type);
            f.queuedEmailPayload.mockResolvedValue(null);
            await expect(f.guard(f.injector, f.ctx, f.email)).resolves.toBe(false);
            expect(f.verifyToken).not.toHaveBeenCalled();
        },
    );
});
