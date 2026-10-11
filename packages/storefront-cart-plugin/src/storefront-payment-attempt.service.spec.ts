import 'reflect-metadata';

import { AutoIncrementIdStrategy } from '@vendure/core';
import { setEntityIdStrategy } from '@vendure/core/dist/entity/set-entity-id-strategy';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddStorefrontPaymentAttempts1791763200000 } from '../../dev-server/migrations/1791763200000-add-storefront-payment-attempts';

import { StorefrontPaymentAttempt } from './entities/storefront-payment-attempt.entity';
import { StorefrontPaymentAttemptService } from './storefront-payment-attempt.service';

setEntityIdStrategy(new AutoIncrementIdStrategy(), [StorefrontPaymentAttempt]);
const database = new DataSource(
    process.env.DB === 'mysql'
        ? {
              type: 'mysql',
              host: '127.0.0.1',
              port: Number(process.env.E2E_MYSQL_PORT),
              username: 'root',
              password: 'password',
              database: 'payment_attempt_fixture',
              entities: [StorefrontPaymentAttempt],
          }
        : { type: 'sqljs', entities: [StorefrontPaymentAttempt] },
);
const ctx: any = { channelId: 5, session: { activeOrderId: 22 } };
const input = {
    requestId: 'request-fixture-0001',
    orderId: 22,
    kind: 'payment' as const,
    method: 'synthetic-payment',
    currencyCode: 'CNY',
    amount: 990,
};
let service: StorefrontPaymentAttemptService;
let carts: any;
let orderRepository: any;

beforeAll(async () => {
    await database.initialize();
    const runner = database.createQueryRunner();
    try {
        await new AddStorefrontPaymentAttempts1791763200000().up(runner);
    } finally {
        await runner.release();
    }
});
afterAll(async () => {
    if (database.isInitialized) await database.destroy();
});
beforeEach(async () => {
    // Only this suite's isolated synthetic database is cleared.
    await database.getRepository(StorefrontPaymentAttempt).clear();
    carts = { findOwnedCart: vi.fn().mockResolvedValue({ id: 2463, checkoutOrderId: 22 }) };
    orderRepository = {
        findOne: vi.fn().mockResolvedValue({
            id: 22,
            salesChannelId: 5,
            active: true,
            state: 'ArrangingPayment',
            currencyCode: 'CNY',
            totalWithTax: 990,
            payments: [],
        }),
    };
    service = new StorefrontPaymentAttemptService(
        { rawConnection: database, getRepository: () => orderRepository } as any,
        carts,
    );
});

describe('payment attempt durable fences against an isolated real database', () => {
    it('retains the order fence when a payment request was applied but still awaits processing', async () => {
        await service.execute(ctx, input, () => Promise.resolve({ id: 22, state: 'ArrangingPayment' }));
        expect(await service.read(ctx, input)).toMatchObject({ status: 'APPLIED' });
        const second = vi.fn();
        await expect(
            service.execute(ctx, { ...input, requestId: 'request-fixture-0002' }, second),
        ).rejects.toThrow('PAYMENT_ATTEMPT_REVIEW_REQUIRED');
        expect(second).not.toHaveBeenCalled();
        await expect(service.assertNoUnresolvedAttempt(ctx)).rejects.toThrow(
            'PAYMENT_ATTEMPT_REVIEW_REQUIRED',
        );
    });
    it('records one result and never executes a replay again', async () => {
        const work = vi.fn().mockResolvedValue({ id: 22 });
        await service.execute(ctx, input, work);
        await expect(service.execute(ctx, input, work)).rejects.toThrow('PAYMENT_REQUEST_ALREADY_APPLIED');
        expect(work).toHaveBeenCalledTimes(1);
        expect(await service.read(ctx, input)).toMatchObject({ status: 'APPLIED', errorCode: null });
    });

    it('permanently fences an unstarted request before the late original request arrives', async () => {
        expect(await service.read(ctx, input)).toMatchObject({ status: 'NOT_FOUND' });
        expect(await service.fenceUnstarted(ctx, input)).toMatchObject({ status: 'NOT_EXECUTED' });
        const work = vi.fn();
        await expect(service.execute(ctx, input, work)).rejects.toThrow('PAYMENT_REQUEST_NOT_EXECUTED');
        expect(work).not.toHaveBeenCalled();
        expect(await service.fenceUnstarted(ctx, input)).toMatchObject({ status: 'NOT_EXECUTED' });
    });

    it('serializes two same-id submissions and a concurrent recovery without re-execution', async () => {
        let started!: () => void;
        const ready = new Promise<void>(resolve => {
            started = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const work = vi.fn(async () => {
            started();
            await gate;
            return { id: 22 };
        });
        const first = service.execute(ctx, input, work);
        await ready;
        await expect(service.execute(ctx, input, work)).rejects.toThrow('PAYMENT_REQUEST_ALREADY_RECEIVED');
        expect(await service.fenceUnstarted(ctx, input)).toMatchObject({ status: 'PROCESSING' });
        release();
        await first;
        expect(work).toHaveBeenCalledTimes(1);
        expect(await service.read(ctx, input)).toMatchObject({ status: 'APPLIED' });
    });

    it('uses database uniqueness to resolve a cancel/start race with at most one execution', async () => {
        const work = vi.fn().mockResolvedValue({ id: 22 });
        await Promise.allSettled([service.execute(ctx, input, work), service.fenceUnstarted(ctx, input)]);
        const result = await service.read(ctx, input);
        expect(['APPLIED', 'NOT_EXECUTED']).toContain(result.status);
        expect(work.mock.calls.length).toBe(result.status === 'APPLIED' ? 1 : 0);
    });

    it('blocks a different id and legacy writer while the order has an unresolved request', async () => {
        const work = vi.fn().mockRejectedValue(new Error('synthetic provider uncertainty'));
        await expect(service.execute(ctx, input, work)).rejects.toThrow('synthetic provider uncertainty');
        expect(await service.read(ctx, input)).toMatchObject({ status: 'UNKNOWN' });
        await expect(
            service.execute(ctx, { ...input, requestId: 'request-fixture-0002' }, work),
        ).rejects.toThrow('PAYMENT_ATTEMPT_REVIEW_REQUIRED');
        await expect(service.assertNoUnresolvedAttempt(ctx)).rejects.toThrow(
            'PAYMENT_ATTEMPT_REVIEW_REQUIRED',
        );
        expect(work).toHaveBeenCalledTimes(1);
    });

    it.each([
        'PAYMENT_DECLINED_ERROR',
        'INELIGIBLE_PAYMENT_METHOD_ERROR',
        'COUPON_REMOVED_DURING_CHECKOUT_ERROR',
    ])('allows a fresh request only after definitive rejection %s', async errorCode => {
        await service.execute(ctx, input, () => Promise.resolve({ errorCode }));
        expect(await service.read(ctx, input)).toMatchObject({ status: 'REJECTED', errorCode });
        await service.execute(ctx, { ...input, requestId: 'request-fixture-0002' }, () =>
            Promise.resolve({ id: 22 }),
        );
        expect(await service.read(ctx, { ...input, requestId: 'request-fixture-0002' })).toMatchObject({
            status: 'APPLIED',
        });
    });

    it('retains ambiguity for payment handler errors and malformed success results', async () => {
        await service.execute(ctx, input, () =>
            Promise.resolve({
                errorCode: 'PAYMENT_FAILED_ERROR',
                paymentErrorMessage: 'private@example.invalid',
            }),
        );
        expect(await service.read(ctx, input)).toMatchObject({ status: 'UNKNOWN' });
        const row = await database
            .getRepository(StorefrontPaymentAttempt)
            .findOneByOrFail({ requestId: input.requestId });
        expect(JSON.stringify(row)).not.toContain('private@example.invalid');
        expect(row.activeOrderKey).toBe('5:22');
    });

    it.each([{ amount: 991 }, { currencyCode: 'USD' }, { method: 'another-method' }, { orderId: 23 }])(
        'rejects reuse of a request id with a different scope %j',
        async patch => {
            await service.fenceUnstarted(ctx, input);
            const work = vi.fn();
            await expect(service.execute(ctx, { ...input, ...patch }, work)).rejects.toThrow(
                'PAYMENT_REQUEST_SCOPE_CHANGED',
            );
            expect(work).not.toHaveBeenCalled();
        },
    );

    it('cannot read or fence another cart or channel request', async () => {
        await service.execute(ctx, input, () => Promise.resolve({ id: 22 }));
        carts.findOwnedCart.mockResolvedValue({ id: 3000, checkoutOrderId: 30 });
        await expect(service.read(ctx, input)).rejects.toThrow();
        await expect(service.fenceUnstarted(ctx, input)).rejects.toThrow();
        carts.findOwnedCart.mockResolvedValue({ id: 2463, checkoutOrderId: 22 });
        await expect(service.read({ ...ctx, channelId: 6 }, input)).rejects.toThrow(
            'PAYMENT_REQUEST_SCOPE_CHANGED',
        );
    });

    it('keeps receipts readable after payment unsets the active order', async () => {
        await service.execute(ctx, input, () => Promise.resolve({ id: 22 }));
        carts.findOwnedCart.mockResolvedValue({ id: 2463, checkoutOrderId: null });
        expect(await service.read({ ...ctx, session: { activeOrderId: undefined } }, input)).toMatchObject({
            status: 'APPLIED',
        });
    });

    it('rejects a scope change detected after claiming without entering the payment work', async () => {
        const original = await orderRepository.findOne();
        orderRepository.findOne
            .mockReset()
            .mockResolvedValueOnce(original)
            .mockResolvedValue({ ...original, totalWithTax: 1000 });
        const work = vi.fn();
        await expect(service.execute(ctx, input, work)).rejects.toThrow('PAYMENT_REQUEST_SCOPE_CHANGED');
        expect(work).not.toHaveBeenCalled();
        expect(await service.read(ctx, input)).toMatchObject({ status: 'REJECTED' });
    });

    it('never converts a missing/malformed result into a successful receipt', async () => {
        await service.execute(ctx, input, () => Promise.resolve(undefined));
        expect(await service.read(ctx, input)).toMatchObject({ status: 'UNKNOWN' });
    });

    it('uses the same fence for an atomic balance payment', async () => {
        const balance = { ...input, kind: 'balance' as const, method: 'referral-balance', amount: 100 };
        const work = vi.fn().mockResolvedValue({ order: { id: 22 }, amount: 100 });
        await service.execute(ctx, balance, work);
        await expect(service.execute(ctx, balance, work)).rejects.toThrow('PAYMENT_REQUEST_ALREADY_APPLIED');
        expect(work).toHaveBeenCalledTimes(1);
    });
});
