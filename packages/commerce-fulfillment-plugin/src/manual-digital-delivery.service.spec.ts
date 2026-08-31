import { describe, expect, it, vi } from 'vitest';

import { ManualDigitalDeliveryEvent } from './entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';

function createHarness(state: ManualDigitalDelivery['state'] = 'DRAFT') {
    const events: ManualDigitalDeliveryEvent[] = [];
    const delivery = new ManualDigitalDelivery({
        id: 'delivery-1',
        state,
        recipientEmail: 'buyer@example.com',
        languageCode: 'zh_Hans',
        productName: 'Virtual item',
        sku: 'VIRTUAL-1',
        quantity: 2,
        expectedAt: new Date(Date.now() + 60_000),
        encryptedPackages: null,
        attachmentAssetIdsJson: '[]',
        attemptCount: 0,
        orderId: 'order-1',
        orderLineId: 'line-1',
        channelId: 'channel-1',
        order: { id: 'order-1', code: 'ORDER-1' },
        orderLine: { id: 'line-1' },
        events,
    });
    const deliveryRepository = {
        findOne: vi.fn().mockResolvedValue(delivery),
        save: vi.fn((value: ManualDigitalDelivery) => Promise.resolve(value)),
    };
    const eventRepository = {
        save: vi.fn((value: ManualDigitalDeliveryEvent) => {
            value.createdAt = new Date();
            events.push(value);
            return Promise.resolve(value);
        }),
    };
    const assetRepository = {
        count: vi.fn().mockResolvedValue(0),
        find: vi.fn().mockResolvedValue([]),
    };
    const connection = {
        getRepository: vi.fn((_ctx: unknown, entity: unknown) => {
            if (entity === ManualDigitalDelivery) return deliveryRepository;
            if (entity === ManualDigitalDeliveryEvent) return eventRepository;
            return assetRepository;
        }),
    };
    const cipher = {
        encrypt: vi.fn(({ payload }: { payload: string }) => `encrypted:${payload}`),
        decrypt: vi.fn((value: string) => ({ payload: value.replace(/^encrypted:/u, '') })),
    };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const orderService = {
        createFulfillment: vi.fn().mockResolvedValue({ id: 'fulfillment-1' }),
        transitionFulfillmentToState: vi.fn().mockResolvedValue({ id: 'fulfillment-1' }),
    };
    const service = new ManualDigitalDeliveryService(
        connection as any,
        cipher as any,
        eventBus as any,
        orderService as any,
        {} as any,
    );
    const ctx = { channelId: 'channel-1', activeUserId: 'admin-1' } as any;
    const packages = [
        { fields: [{ key: 'account', label: '账号', value: 'one' }], note: '' },
        { fields: [{ key: 'account', label: '账号', value: 'two' }], note: '' },
    ];
    return { service, delivery, events, eventBus, orderService, ctx, packages };
}

describe('ManualDigitalDeliveryService invariants', () => {
    it('blocks publishing when the number of finished packages differs from the order quantity', async () => {
        const test = createHarness();

        await expect(
            test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages.slice(0, 1) }),
        ).rejects.toThrow('必须录入并发布 2 个成品包');
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it('publishes exact packages and retries the same encrypted content', async () => {
        const test = createHarness();

        await test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages });
        const originalEncryptedPackages = test.delivery.encryptedPackages;
        expect(test.events.at(-1)).toMatchObject({ type: 'PUBLISHED', actorType: 'ADMIN' });
        expect(test.eventBus.publish).toHaveBeenCalledTimes(1);

        test.delivery.state = 'EMAIL_FAILED';
        await test.service.retry(test.ctx, test.delivery.id);

        expect(test.delivery.encryptedPackages).toBe(originalEncryptedPackages);
        expect(test.events.at(-1)).toMatchObject({ type: 'MANUAL_RETRY', actorType: 'ADMIN' });
        expect(test.eventBus.publish).toHaveBeenCalledTimes(2);
    });

    it('does not allow failed or sent deliveries to overwrite the original packages', async () => {
        const test = createHarness('EMAIL_FAILED');

        await expect(
            test.service.saveDraft(test.ctx, { id: test.delivery.id, packages: test.packages }),
        ).rejects.toThrow('当前人工交付状态不能修改成品内容');
    });

    it('completes fulfillment only after the email succeeds', async () => {
        const test = createHarness('SENDING');

        await test.service.recordEmailResult(test.ctx, test.delivery.id, true);

        expect(test.delivery.state).toBe('SENT');
        expect(test.orderService.createFulfillment).toHaveBeenCalledOnce();
        expect(test.delivery.fulfillmentId).toBe('fulfillment-1');
        expect(test.events.at(-1)).toMatchObject({ type: 'EMAIL_SENT' });
    });
});
