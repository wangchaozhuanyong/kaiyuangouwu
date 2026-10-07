import { FulfillmentLine, Payment, Permission } from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { describe, expect, it, vi } from 'vitest';

import { DigitalReceiptAccess } from './entities/digital-product.entity';
import { ManualDigitalDeliveryEvent } from './entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { ManualDigitalDeliveryReadyEvent } from './manual-digital-delivery.event';
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
        order: {
            id: 'order-1',
            code: 'ORDER-1',
            salesChannelId: 'channel-1',
            state: 'PaymentSettled',
            active: false,
            fulfillments: [],
            payments: [
                { id: 'payment-1', method: 'real-provider', state: 'Settled', amount: 1000, refunds: [] },
            ],
        },
        orderLine: {
            id: 'line-1',
            quantity: 2,
            order: { id: 'order-1' },
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
        },
        events,
    });
    const deliveryRepository = {
        find: vi.fn().mockResolvedValue([delivery]),
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
    const receiptRepository = { count: vi.fn().mockResolvedValue(0) };
    const fulfillmentRepository = {
        count: vi.fn().mockResolvedValue(0),
        find: vi.fn().mockResolvedValue([]),
    };
    const paymentRepository = { find: vi.fn(() => Promise.resolve(delivery.order.payments)) };
    const connection = {
        findByIdsInChannel: vi.fn().mockResolvedValue([]),
        getRepository: vi.fn((_ctx: unknown, entity: unknown) => {
            if (entity === ManualDigitalDelivery) return deliveryRepository;
            if (entity === ManualDigitalDeliveryEvent) return eventRepository;
            if (entity === Payment) return paymentRepository;
            if (entity === DigitalReceiptAccess) return receiptRepository;
            if (entity === FulfillmentLine) return fulfillmentRepository;
            return assetRepository;
        }),
        rawConnection: {
            getRepository: vi.fn(() => deliveryRepository),
        },
    };
    const cipher = {
        encrypt: vi.fn(({ payload }: { payload: string }) => `encrypted:${payload}`),
        decrypt: vi.fn((value: string) => ({ payload: value.replace(/^encrypted:/u, '') })),
    };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const orderService = {
        withOrderMutationTransaction: vi.fn((ctxValue, operation) => operation(ctxValue)),
        lockOrderForRefund: vi.fn().mockResolvedValue(undefined),
        createFulfillment: vi.fn().mockResolvedValue({ id: 'fulfillment-1' }),
        transitionFulfillmentToState: vi.fn().mockResolvedValue({ id: 'fulfillment-1' }),
    };
    const digitalProducts = { consumeLine: vi.fn(), lock: vi.fn().mockResolvedValue(undefined) };
    const requestContexts = { create: vi.fn(() => Promise.resolve(ctx)) };
    const service = new ManualDigitalDeliveryService(
        connection as any,
        cipher as any,
        eventBus as any,
        orderService as any,
        requestContexts as any,
        digitalProducts as any,
        { createForDigitalReceipt: vi.fn(() => ({ token: 'synthetic-receipt-proof' })) } as any,
        { appendAudit: vi.fn().mockResolvedValue(undefined) } as any,
    );
    const ctx = {
        channelId: 'channel-1',
        activeUserId: 'admin-1',
        apiType: 'admin',
        userHasPermissions: vi.fn((permissions: Permission[]) => permissions.includes(Permission.SuperAdmin)),
    } as any;
    const packages = [
        { fields: [{ key: 'account', label: '账号', value: 'one' }], note: '' },
        { fields: [{ key: 'account', label: '账号', value: 'two' }], note: '' },
    ];
    return {
        service,
        delivery,
        events,
        eventBus,
        orderService,
        ctx,
        packages,
        connection,
        cipher,
        digitalProducts,
        deliveryRepository,
        receiptRepository,
        fulfillmentRepository,
        paymentRepository,
    };
}

describe('ManualDigitalDeliveryService invariants', () => {
    it('shows the current order email used by notification without exposing content', async () => {
        const test = createHarness();
        test.delivery.order.customFields = { deliveryEmail: ' updated@example.invalid ' };
        const viewed = await test.service.one(test.ctx, test.delivery.id);
        expect(viewed.recipientEmail).toBe('updated@example.invalid');
        expect((viewed as ManualDigitalDelivery & { packages: unknown[] }).packages).toEqual([]);
        expect(test.connection.getRepository).toHaveBeenCalled();
    });
    it.each(['Pending', 'Settled'])(
        'blocks publishing, retry and queued email after a full %s refund',
        async refundState => {
            const test = createHarness();
            await test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages });
            (test.delivery.order.payments[0] as any).refunds = [
                { state: refundState, total: 1000, lines: [{ orderLineId: 'line-1', quantity: 2 }] },
            ];
            test.eventBus.publish.mockClear();
            test.delivery.state = 'DRAFT';
            await expect(
                test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages }),
            ).rejects.toThrow('正在退款');
            test.delivery.state = 'EMAIL_FAILED';
            await expect(test.service.retry(test.ctx, test.delivery.id)).rejects.toThrow('正在退款');
            test.delivery.state = 'SENDING';
            await expect(test.service.queuedEmailPayload(test.ctx, test.delivery.id)).rejects.toThrow(
                '领取资格已暂停',
            );
            expect(test.eventBus.publish).not.toHaveBeenCalled();
        },
    );

    it('retains paid partial-refund compensation and ignores failed refunds', async () => {
        const test = createHarness();
        (test.delivery.order.payments[0] as any).refunds = [
            { state: 'Settled', total: 200 },
            { state: 'Failed', total: 800 },
        ];
        await expect(
            test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages }),
        ).resolves.toMatchObject({ state: 'SENDING' });
    });

    it('blocks cancelled orders and lines without creating a delivery event', async () => {
        const test = createHarness();
        test.delivery.order.state = 'Cancelled';
        await expect(
            test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages }),
        ).rejects.toThrow('订单已取消');
        test.delivery.order.state = 'PaymentSettled';
        test.delivery.orderLine.quantity = 0;
        await expect(
            test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages }),
        ).rejects.toThrow('订单已取消');
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it.each(['CANCELLED', 'SENT'] as const)(
        'preserves terminal state %s after old queue results',
        async state => {
            const test = createHarness(state);
            await test.service.recordEmailResult(
                test.ctx,
                test.delivery.id,
                false,
                new Error('late attempt'),
            );
            await test.service.recordEmailResult(test.ctx, test.delivery.id, true);
            expect(test.delivery.state).toBe(state);
            expect(test.delivery.attemptCount).toBe(0);
            expect(test.events).toHaveLength(0);
            expect(test.orderService.createFulfillment).not.toHaveBeenCalled();
        },
    );

    it.each(['CANCELLED', 'SENT', 'DRAFT', 'MANUAL_REVIEW'] as const)(
        'blocks queued mail for %s',
        async state => {
            const test = createHarness(state);
            await expect(test.service.queuedEmailPayload(test.ctx, test.delivery.id)).rejects.toThrow(
                '不能发送邮件',
            );
        },
    );

    it('rejects public product assets as delivery attachments before draft persistence', async () => {
        const test = createHarness();
        await expect(
            test.service.saveDraft(test.ctx, {
                id: test.delivery.id,
                packages: [{ note: 'test', attachmentAssetIds: ['foreign'] }],
            }),
        ).rejects.toThrow('私有交付文件');
        expect(test.delivery.encryptedPackages).toBeNull();
        expect(test.connection.findByIdsInChannel).not.toHaveBeenCalled();
    });

    it('checks private attachment ownership before persistence', async () => {
        const test = createHarness();
        await expect(
            test.service.saveDraft(test.ctx, {
                id: test.delivery.id,
                packages: [{ note: 'test', attachmentFileVersionIds: ['foreign'] }],
            }),
        ).rejects.toThrow('不属于当前店铺');
        expect(test.delivery.encryptedPackages).toBeNull();
    });
    it('does not require a delivery email for a physical-only settled order', async () => {
        const test = createHarness();

        await expect(
            test.service.createSettledOrderTasks(test.ctx, {
                id: 'order-physical',
                state: 'PaymentSettled',
                customFields: {},
                lines: [
                    {
                        customFields: { fulfillmentTypeSnapshot: 'physical' },
                        productVariant: { customFields: { fulfillmentType: 'physical' } },
                    },
                ],
            } as any),
        ).resolves.toEqual([]);
    });

    it('blocks publishing when the number of finished packages differs from the order quantity', async () => {
        const test = createHarness();

        await expect(
            test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages.slice(0, 1) }),
        ).rejects.toThrow('当前需交付 2 份');
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it('publishes exact packages and retries the same encrypted content', async () => {
        const test = createHarness();

        await test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages });
        const originalEncryptedPackages = test.delivery.encryptedPackages;
        expect(test.events.at(-1)).toMatchObject({ type: 'PUBLISHED', actorType: 'ADMIN' });
        expect(
            test.eventBus.publish.mock.calls.filter(
                ([event]) => event instanceof ManualDigitalDeliveryReadyEvent,
            ),
        ).toHaveLength(1);

        test.delivery.state = 'EMAIL_FAILED';
        await test.service.retry(test.ctx, test.delivery.id);

        expect(test.delivery.encryptedPackages).toBe(originalEncryptedPackages);
        expect(test.events.at(-1)).toMatchObject({ type: 'MANUAL_RETRY', actorType: 'ADMIN' });
        expect(
            test.eventBus.publish.mock.calls.filter(
                ([event]) => event instanceof ManualDigitalDeliveryReadyEvent,
            ),
        ).toHaveLength(2);
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

    it('raises a P1 incident after repeated email failures require manual review', async () => {
        const test = createHarness('EMAIL_FAILED');
        test.delivery.attemptCount = 4;

        await test.service.recordEmailResult(test.ctx, test.delivery.id, false, new Error('SMTP down'));

        expect(test.delivery.state).toBe('MANUAL_REVIEW');
        const notification = test.eventBus.publish.mock.calls
            .map(call => call[0])
            .find(event => event instanceof AdminNotificationRequestedEvent);
        expect(notification?.notification).toMatchObject({
            mode: 'INCIDENT_FIRING',
            eventType: 'commerce.fulfillment.manual_delivery_failed',
            severity: 'P1',
        });
        expect(notification?.notification.payload).not.toHaveProperty('recipientEmail');
    });

    it('keeps the first failure for manual review and resolves its incident after a successful retry', async () => {
        const test = createHarness('EMAIL_FAILED');
        test.delivery.state = 'DRAFT';
        await test.service.publish(test.ctx, { id: test.delivery.id, packages: test.packages });
        test.delivery.state = 'EMAIL_FAILED';
        test.delivery.attemptCount = 4;
        await test.service.recordEmailResult(
            test.ctx,
            test.delivery.id,
            false,
            new Error('SMTP rejected recipient'),
        );
        expect(test.delivery.state).toBe('MANUAL_REVIEW');
        const attempts = test.delivery.attemptCount;
        test.eventBus.publish.mockClear();

        await test.service.recordEmailResult(
            test.ctx,
            test.delivery.id,
            false,
            new Error('人工交付任务已关闭或当前状态不能发送邮件'),
        );
        expect(test.delivery.lastError).toBe('SMTP rejected recipient');
        expect(test.delivery.attemptCount).toBe(attempts);
        expect(test.eventBus.publish).not.toHaveBeenCalled();

        await test.service.retry(test.ctx, test.delivery.id);
        await test.service.recordEmailResult(test.ctx, test.delivery.id, true);
        expect(test.delivery.state).toBe('SENT');
        expect(
            test.eventBus.publish.mock.calls.some(
                call =>
                    call[0] instanceof AdminNotificationRequestedEvent &&
                    call[0].notification.mode === 'INCIDENT_RESOLVED',
            ),
        ).toBe(true);
    });
});

it.each(['channel-2', null])(
    'rejects mail for a task whose parent order sale owner is %s',
    async salesChannelId => {
        const test = createHarness('SENDING');
        test.delivery.order.salesChannelId = salesChannelId;
        await expect(test.service.queuedEmailPayload(test.ctx, test.delivery.id)).rejects.toThrow();
        await expect(test.service.recordEmailResult(test.ctx, test.delivery.id, true)).rejects.toThrow();
        expect(test.delivery.state).toBe('SENDING');
        expect(test.events).toHaveLength(0);
        expect(test.orderService.createFulfillment).not.toHaveBeenCalled();
    },
);

function historicalHarness() {
    const test = createHarness('MANUAL_REVIEW');
    test.delivery.order.state = 'Modifying';
    Object.assign(test.delivery.order.payments[0], {
        method: 'controlled-test-payment-channel-1',
        metadata: { public: { testPayment: true } },
    });
    test.delivery.encryptedPackages = 'encrypted:synthetic-published-content';
    test.delivery.attemptCount = 7;
    test.delivery.lastError = 'original synthetic notification failure';
    test.delivery.lastDispatchedAt = new Date('2026-09-27T23:25:09.659Z');
    test.events.push(
        new ManualDigitalDeliveryEvent({
            type: 'PUBLISHED',
            note: 'original publication',
            createdAt: new Date('2026-09-27T21:43:08.455Z'),
        }),
    );
    return test;
}

describe('server-only historical test task closure', () => {
    it('preserves published content, original order/payment and failure history with one receipt', async () => {
        const test = historicalHarness();
        const order = JSON.stringify(test.delivery.order);
        const first = await test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37');
        await test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37');
        expect(first.state).toBe('CANCELLED');
        expect((first as any).packages).toEqual([]);
        expect(test.delivery.encryptedPackages).toBe('encrypted:synthetic-published-content');
        expect(test.delivery.attemptCount).toBe(7);
        expect(test.delivery.lastError).toBe('original synthetic notification failure');
        expect(JSON.stringify(test.delivery.order)).toBe(order);
        expect(test.events.filter(event => event.type === 'CANCELLED')).toEqual([
            expect.objectContaining({
                actorType: 'ADMIN',
                note: '历史测试任务终止；收据 close-37',
            }),
        ]);
        expect(test.cipher.decrypt).not.toHaveBeenCalled();
        expect(test.orderService.createFulfillment).not.toHaveBeenCalled();
        expect(
            test.eventBus.publish.mock.calls.some(
                ([event]) => event instanceof AdminNotificationRequestedEvent,
            ),
        ).toBe(false);
        expect(test.paymentRepository.find).toHaveBeenCalledWith({
            where: { order: { id: 'order-1' } },
            order: { id: 'ASC' },
        });
        expect(test.orderService.lockOrderForRefund.mock.invocationCallOrder[0]).toBeLessThan(
            test.digitalProducts.lock.mock.invocationCallOrder[0],
        );
        expect(test.digitalProducts.lock.mock.calls.slice(0, 2).map(call => call.slice(1))).toEqual([
            [Payment, 'payment-1'],
            [ManualDigitalDelivery, 'delivery-1'],
        ]);
    });

    it.each(['shop', 'no-user', 'readonly', 'bad-receipt'])(
        'rejects non-managed authorization %s before any mutation lock',
        async condition => {
            const test = historicalHarness();
            if (condition === 'shop') test.ctx.apiType = 'shop';
            if (condition === 'no-user') test.ctx.activeUserId = undefined;
            if (condition === 'readonly') test.ctx.userHasPermissions.mockReturnValue(false);
            await expect(
                test.service.closeHistoricalTestTask(
                    test.ctx,
                    test.delivery.id,
                    condition === 'bad-receipt' ? 'bad receipt' : 'close-37',
                ),
            ).rejects.toThrow();
            expect(test.orderService.lockOrderForRefund).not.toHaveBeenCalled();
            expect(test.delivery.state).toBe('MANUAL_REVIEW');
        },
    );

    it.each(['real', 'unknown', 'unmarked', 'foreign-test', 'refund', 'unloaded-refund', 'manual-review'])(
        'rejects funding evidence %s without altering original task',
        async condition => {
            const test = historicalHarness();
            const payment = test.delivery.order.payments[0] as any;
            if (condition === 'real') payment.method = 'real-provider';
            if (condition === 'unknown') payment.state = 'Created';
            if (condition === 'unmarked') payment.metadata.public.testPayment = false;
            if (condition === 'foreign-test') payment.method = 'controlled-test-payment-channel-2';
            if (condition === 'refund') payment.refunds = [{ state: 'Failed' }];
            if (condition === 'unloaded-refund') payment.refunds = undefined;
            if (condition === 'manual-review') payment.metadata.manualReview = { required: true };
            await expect(
                test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37'),
            ).rejects.toThrow();
            expect(test.delivery.state).toBe('MANUAL_REVIEW');
            expect(test.deliveryRepository.save).not.toHaveBeenCalled();
            expect(test.events).toHaveLength(1);
        },
    );

    it.each([
        'foreign-owner',
        'foreign-line',
        'physical',
        'missing-snapshot',
        'unpublished',
        'sent',
        'sent-at',
        'fulfillment-id',
        'claimed',
        'fulfilled',
    ])('retains protected delivery evidence %s', async condition => {
        const test = historicalHarness();
        if (condition === 'foreign-owner') test.delivery.order.salesChannelId = 'channel-2';
        if (condition === 'foreign-line') test.delivery.orderLine.order.id = 'foreign-order';
        if (condition === 'physical')
            test.delivery.orderLine.customFields.fulfillmentTypeSnapshot = 'physical';
        if (condition === 'missing-snapshot')
            delete (
                test.delivery.orderLine.customFields as Partial<typeof test.delivery.orderLine.customFields>
            ).fulfillmentTypeSnapshot;
        if (condition === 'unpublished') test.events.length = 0;
        if (condition === 'sent') test.delivery.state = 'SENT';
        if (condition === 'sent-at') test.delivery.sentAt = new Date();
        if (condition === 'fulfillment-id') test.delivery.fulfillmentId = 'fulfillment-1';
        if (condition === 'claimed') test.receiptRepository.count.mockResolvedValue(1);
        if (condition === 'fulfilled') test.fulfillmentRepository.count.mockResolvedValue(1);
        const state = test.delivery.state;
        await expect(
            test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37'),
        ).rejects.toThrow();
        expect(test.delivery.state).toBe(state);
        expect(test.deliveryRepository.save).not.toHaveBeenCalled();
    });

    it('does not replace the receipt of a previous close', async () => {
        const test = historicalHarness();
        await test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37');
        await expect(
            test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'different'),
        ).rejects.toThrow();
        expect(test.events.filter(event => event.type === 'CANCELLED')).toHaveLength(1);
    });

    it('records late success and failure once per original dispatch without reopening or exposing the error', async () => {
        const test = historicalHarness();
        await test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37');
        await test.service.recordEmailResult(test.ctx, test.delivery.id, true);
        await test.service.recordEmailResult(test.ctx, test.delivery.id, true);
        await test.service.recordEmailResult(
            test.ctx,
            test.delivery.id,
            false,
            new Error('synthetic opaque error'),
        );
        await test.service.recordEmailResult(
            test.ctx,
            test.delivery.id,
            false,
            new Error('synthetic opaque error'),
        );
        expect(test.delivery.state).toBe('CANCELLED');
        expect(test.delivery.attemptCount).toBe(7);
        expect(test.delivery.lastError).toBe('original synthetic notification failure');
        expect(test.delivery.sentAt).toBeUndefined();
        expect(test.events.filter(event => event.note.startsWith('[historical-test-late:'))).toEqual([
            expect.objectContaining({ type: 'EMAIL_SENT' }),
            expect.objectContaining({ type: 'EMAIL_FAILED' }),
        ]);
        expect(test.events.some(event => event.note.includes('synthetic opaque error'))).toBe(false);
        expect(test.orderService.createFulfillment).not.toHaveBeenCalled();
        await expect(
            test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37'),
        ).rejects.toThrow('需继续核对');
    });

    it('checks fresh funding after acquiring the order lock', async () => {
        const test = historicalHarness();
        test.orderService.lockOrderForRefund.mockImplementation(() => {
            (test.delivery.order.payments[0] as any).method = 'late-real-provider';
            return Promise.resolve();
        });
        await expect(
            test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37'),
        ).rejects.toThrow();
        expect(test.deliveryRepository.findOne).toHaveBeenCalledTimes(2);
        expect(test.deliveryRepository.save).not.toHaveBeenCalled();
    });

    it('does not reopen a closed task from a scheduler candidate captured before closure', async () => {
        const test = historicalHarness();
        const stale = new ManualDigitalDelivery({ ...test.delivery, state: 'EMAIL_FAILED' });
        test.deliveryRepository.find.mockResolvedValue([stale]);
        await test.service.closeHistoricalTestTask(test.ctx, test.delivery.id, 'close-37');
        test.eventBus.publish.mockClear();
        await expect(test.service.reconcilePending()).resolves.toEqual({
            redispatched: 0,
            completedFulfillments: 0,
        });
        expect(test.delivery.state).toBe('CANCELLED');
        expect(test.events.some(event => event.type === 'AUTO_RETRY')).toBe(false);
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it('rereads a real retry after waiting rather than restoring its observed old state', async () => {
        const test = createHarness('EMAIL_FAILED');
        test.delivery.encryptedPackages = 'encrypted:synthetic-published-content';
        let resume!: () => void;
        test.orderService.lockOrderForRefund.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    resume = resolve;
                }),
        );
        const pending = test.service.retry(test.ctx, test.delivery.id);
        const rejected = expect(pending).rejects.toThrow('当前状态不能重发');
        await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
        test.delivery.state = 'CANCELLED';
        resume();
        await rejected;
        expect(test.delivery.state).toBe('CANCELLED');
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it('still retries an eligible real notification', async () => {
        const test = createHarness('EMAIL_FAILED');
        await expect(test.service.reconcilePending()).resolves.toEqual({
            redispatched: 1,
            completedFulfillments: 0,
        });
        expect(test.delivery.state).toBe('SENDING');
        expect(test.events.some(event => event.type === 'AUTO_RETRY')).toBe(true);
        expect(
            test.eventBus.publish.mock.calls.some(
                ([event]) => event instanceof ManualDigitalDeliveryReadyEvent,
            ),
        ).toBe(true);
    });
});
