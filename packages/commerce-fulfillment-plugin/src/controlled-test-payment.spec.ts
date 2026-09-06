import { ConfigService, Order, TransactionalConnection } from '@vendure/core';
import { StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledTestPayment } from './controlled-test-payment';

describe('test payments use the normal checkout workflow', () => {
    let order: any;
    let method: any;
    let ctx: any;
    let registered: ReturnType<typeof createControlledTestPayment>;
    const carts = { lockForOrder: vi.fn() };
    const lockOrder = vi.fn();
    const connection = {
        findOneInChannel: vi.fn(),
        getRepository: vi.fn(() => ({ update: lockOrder, findOne: vi.fn(() => Promise.resolve(method)) })),
    };
    const config = { entityOptions: {}, entityIdStrategy: { encodeId: (id: unknown) => `T_${String(id)}` } };
    const injector = {
        get: (token: unknown) =>
            new Map<unknown, unknown>([
                [TransactionalConnection, connection],
                [ConfigService, config],
                [StorefrontCartService, carts],
            ]).get(token),
    } as any;

    beforeEach(async () => {
        vi.clearAllMocks();
        lockOrder.mockResolvedValue({ affected: 1 });
        order = {
            id: 1,
            active: true,
            state: 'ArrangingPayment',
            totalWithTax: 1000,
            couponCodes: [],
            payments: [],
            customer: { id: 7, user: { id: 9, verified: true, deletedAt: null } },
        };
        ctx = { apiType: 'shop', channelId: 2, activeUserId: 9 };
        method = {
            id: 3,
            enabled: true,
            code: 'controlled-test-payment-T_2',
            handler: { code: 'controlled-test-payment-handler', args: [{ name: 'channelId', value: 'T_2' }] },
            checker: { code: 'controlled-test-payment-checker', args: [] },
        };
        connection.findOneInChannel.mockImplementation((_ctx, entity) =>
            Promise.resolve(entity === Order ? order : method),
        );
        registered = createControlledTestPayment(true);
        await registered.handler.init(injector);
    });

    const pay = (amount = 1000) =>
        registered.handler.createPayment(
            ctx,
            order,
            amount,
            method.handler.args,
            { public: { testPayment: false }, state: 'Authorized', amount: 1 },
            method,
        );
    const transition = (amount = 1000) =>
        registered.paymentProcess.onTransitionStart?.('Created', 'Settled', {
            ctx,
            order,
            payment: { amount, method: method.code },
        } as any);

    it('settles the server amount and overwrites client-provided payment data', async () => {
        expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
        const payment = await pay();
        expect(payment).toMatchObject({
            amount: 1000,
            state: 'Settled',
            metadata: { public: { testPayment: true } },
        });
        expect(payment.transactionId).toMatch(/^test-/);
        expect(await transition()).toBeUndefined();
        expect(connection.findOneInChannel).toHaveBeenCalledWith(
            ctx,
            Order,
            order.id,
            ctx.channelId,
            expect.objectContaining({ lock: { mode: 'pessimistic_write' }, relationLoadStrategy: 'join' }),
        );
    });

    it.each([9, 10, 11, undefined])(
        'does not require a test whitelist for checkout user %s',
        async userId => {
            ctx.activeUserId = userId;
            order.customer = { id: userId ?? 20, user: userId ? { id: userId, verified: true } : null };
            expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
            expect(await pay()).toMatchObject({ state: 'Settled' });
            expect(registered.handler.args).not.toHaveProperty('customerIds');
        },
    );

    it('accepts existing JSON-encoded channel arguments and ignores the retired whitelist', async () => {
        method.handler.args = [
            { name: 'channelId', value: JSON.stringify('T_2') },
            { name: 'customerIds', value: 'old-customer' },
        ];
        expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
        expect(await pay()).toMatchObject({ state: 'Settled' });
    });

    it('supports discounted totals and settles only the remainder after previous payments and refunds', async () => {
        order.couponCodes = ['DISCOUNT'];
        order.payments = [
            { state: 'Settled', amount: 400, refunds: [{ state: 'Settled', total: 100 }] },
            { state: 'Declined', amount: 1000 },
        ];
        expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
        expect(await pay(700)).toMatchObject({ amount: 700, state: 'Settled' });
        expect(await transition(700)).toBeUndefined();
        await expect(pay(1000)).rejects.toThrow('金额');
        expect(await transition(1000)).toContain('金额');
    });

    it('supports a zero-amount checkout after a full discount', async () => {
        order.totalWithTax = 0;
        expect(await pay(0)).toMatchObject({ amount: 0, state: 'Settled' });
        expect(await transition(0)).toBeUndefined();
    });

    it('rejects concurrent completion inside the payment transaction', async () => {
        lockOrder.mockResolvedValue({ affected: 0 });
        expect(await transition()).toBeTruthy();
    });

    it.each([
        [
            'admin API',
            () => {
                ctx.apiType = 'admin';
            },
        ],
        [
            'another channel',
            () => {
                ctx.channelId = 4;
            },
        ],
        [
            'disabled method',
            () => {
                method.enabled = false;
            },
        ],
        [
            'removed checker',
            () => {
                method.checker = null;
            },
        ],
        [
            'wrong handler',
            () => {
                method.handler.code = 'dummy-payment-handler';
            },
        ],
        [
            'completed order',
            () => {
                order.active = false;
                order.state = 'PaymentSettled';
            },
        ],
        [
            'historical test order',
            () => {
                order.active = false;
                order.state = 'TestPaymentSettled';
            },
        ],
        [
            'negative remaining amount',
            () => {
                order.payments = [{ state: 'Settled', amount: 1100 }];
            },
        ],
    ] as const)(
        'rejects %s through eligibility, creation and the payment transaction',
        async (_name, mutate) => {
            mutate();
            expect(await registered.checker.check(ctx, order, [], method)).toBe(false);
            await expect(pay()).rejects.toThrow();
            expect(await transition()).toBeTruthy();
        },
    );

    it('rejects missing orders and disabled server configuration', async () => {
        connection.findOneInChannel.mockImplementation((_ctx, entity) =>
            Promise.resolve(entity === Order ? undefined : method),
        );
        await expect(pay()).rejects.toThrow();
        registered = createControlledTestPayment(false);
        await registered.checker.init(injector);
        expect(await registered.checker.check(ctx, order, [], method)).toBe(false);
        await expect(pay()).rejects.toThrow();
    });

    it('retains legacy terminal records but allows normal paid-order fulfillment', async () => {
        expect(
            await registered.paymentProcess.onTransitionStart?.('TestSettled', 'Settled', {
                ctx,
                order,
            } as any),
        ).toBeTruthy();
        expect(
            await registered.orderProcess.onTransitionStart?.('TestPaymentSettled', 'PaymentSettled', {
                ctx,
                order,
            }),
        ).toBeTruthy();
        expect(
            registered.fulfillmentProcess.onTransitionStart?.('Created', 'Pending', {
                orders: [{ state: 'TestPaymentSettled' }],
            } as any),
        ).toBeTruthy();
        expect(
            registered.fulfillmentProcess.onTransitionStart?.('Created', 'Pending', {
                orders: [{ state: 'PaymentSettled' }],
            } as any),
        ).toBeUndefined();
    });
});
