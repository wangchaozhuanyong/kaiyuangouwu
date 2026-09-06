import {
    ConfigService,
    Customer,
    Order,
    OrderService,
    PaymentMethod,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartLifecycleService, StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledTestPayment, testPaymentCustomerIds } from './controlled-test-payment';

describe('controlled test payment boundaries', () => {
    let order: any;
    let method: any;
    let ctx: any;
    let registered: ReturnType<typeof createControlledTestPayment>;
    const lifecycle = { completeCheckoutForOrder: vi.fn() };
    const carts = { lockForOrder: vi.fn() };
    const lockOrder = vi.fn();
    const orders = { getOrderPayments: vi.fn(), transitionToState: vi.fn() };
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
                [OrderService, orders],
                [StorefrontCartService, carts],
                [StorefrontCartLifecycleService, lifecycle],
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
            handler: {
                code: 'controlled-test-payment-handler',
                args: [
                    { name: 'channelId', value: 'T_2' },
                    { name: 'customerIds', value: 'T_7' },
                ],
            },
            checker: { code: 'controlled-test-payment-checker', args: [] },
        };
        connection.findOneInChannel.mockImplementation((_ctx, entity) =>
            Promise.resolve(entity === Order ? order : entity === PaymentMethod ? method : { id: 7 }),
        );
        registered = createControlledTestPayment(true);
        await registered.handler.init(injector);
    });

    const pay = () =>
        registered.handler.createPayment(
            ctx,
            order,
            1000,
            method.handler.args,
            { public: { testPayment: false }, state: 'Settled', amount: 1 },
            method,
        );

    it('accepts only a verified, owned, allowlisted account and overwrites client metadata', async () => {
        expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
        const payment = await pay();
        expect(payment).toMatchObject({
            amount: 1000,
            state: 'TestSettled',
            metadata: { public: { testPayment: true } },
        });
        expect(payment.transactionId).toMatch(/^test-/);
        expect(lifecycle.completeCheckoutForOrder).not.toHaveBeenCalled();
    });

    it('accepts JSON text arguments sent by the admin configuration editor', async () => {
        method.handler.args = method.handler.args.map((arg: { name: string; value: string }) => ({
            ...arg,
            value: JSON.stringify(arg.value),
        }));
        expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
        expect(await pay()).toMatchObject({ state: 'TestSettled' });
    });

    it('rejects a concurrent completion even if the transaction still reads a payable snapshot', async () => {
        lockOrder.mockResolvedValue({ affected: 0 });
        expect(await registered.checker.check(ctx, order, [], method)).toBe(true);
        await expect(pay()).rejects.toThrow();
        expect(
            await registered.paymentProcess.onTransitionStart?.('Created', 'TestSettled', {
                ctx,
                order,
                payment: { amount: 1000, method: method.code },
            } as any),
        ).toBeTruthy();
    });

    it.each([
        [
            'guest',
            () => {
                ctx.activeUserId = undefined;
            },
        ],
        [
            'another logged-in user',
            () => {
                ctx.activeUserId = 10;
            },
        ],
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
            'not allowlisted',
            () => {
                method.handler.args[1].value = 'T_8';
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
            'unverified account',
            () => {
                order.customer.user.verified = false;
            },
        ],
        [
            'deleted account',
            () => {
                order.customer.user.deletedAt = new Date();
            },
        ],
        [
            'coupon',
            () => {
                order.couponCodes = ['REAL-COUPON'];
            },
        ],
        [
            'real balance mixed payment',
            () => {
                order.payments = [{ state: 'Settled', method: 'referral-balance' }];
            },
        ],
        [
            'USDT mixed payment',
            () => {
                order.payments = [{ state: 'Authorized', method: 'usdt-trc20' }];
            },
        ],
        [
            'duplicate test payment',
            () => {
                order.payments = [{ state: 'TestSettled' }];
            },
        ],
        [
            'already completed order',
            () => {
                order.active = false;
                order.state = 'TestPaymentSettled';
            },
        ],
        [
            'zero total',
            () => {
                order.totalWithTax = 0;
            },
        ],
    ] as const)('rejects %s through both eligibility and direct payment', async (_name, mutate) => {
        mutate();
        expect(await registered.checker.check(ctx, order, [], method)).toBe(false);
        await expect(pay()).rejects.toThrow();
    });

    it('rejects a customer removed from the active channel', async () => {
        connection.findOneInChannel.mockImplementation((_ctx, entity) =>
            Promise.resolve(entity === Customer ? undefined : entity === Order ? order : method),
        );
        expect(await registered.checker.check(ctx, order, [], method)).toBe(false);
        await expect(pay()).rejects.toThrow();
    });

    it('keeps saved methods ineligible when the server switch is off', async () => {
        registered = createControlledTestPayment(false);
        await registered.checker.init(injector);
        expect(await registered.checker.check(ctx, order, [], method)).toBe(false);
        await expect(pay()).rejects.toThrow();
    });

    it('prevents fake order transitions and mixed payments from becoming a completed test', async () => {
        orders.getOrderPayments.mockResolvedValue([{ method: method.code, amount: 1000, state: 'Settled' }]);
        expect(
            await registered.orderProcess.onTransitionStart?.('ArrangingPayment', 'TestPaymentSettled', {
                ctx,
                order,
            }),
        ).toBeTypeOf('string');
        orders.getOrderPayments.mockResolvedValue([
            { method: method.code, amount: 1000, state: 'TestSettled' },
        ]);
        expect(
            await registered.orderProcess.onTransitionStart?.('ArrangingPayment', 'TestPaymentSettled', {
                ctx,
                order,
            }),
        ).toBeUndefined();
    });

    it('completes the cart without placing an order for accounting and rejects real fulfillment', async () => {
        await registered.orderProcess.onTransitionEnd?.('ArrangingPayment', 'TestPaymentSettled', {
            ctx,
            order,
        });
        expect(order.active).toBe(false);
        expect(order.orderPlacedAt).toBeUndefined();
        expect(lifecycle.completeCheckoutForOrder).toHaveBeenCalledWith(ctx, order.id);
        expect(
            registered.fulfillmentProcess.onTransitionStart?.('Created', 'Pending', {
                orders: [{ state: 'TestPaymentSettled' }],
            } as any),
        ).toBeTypeOf('string');
        expect(
            registered.fulfillmentProcess.onTransitionStart?.('Created', 'Pending', {
                orders: [{ state: 'PaymentSettled' }],
            } as any),
        ).toBeUndefined();
    });

    it('rejects malformed or unbounded allowlists', () => {
        expect(() => testPaymentCustomerIds('')).toThrow();
        expect(() => testPaymentCustomerIds('T_7;DROP')).toThrow();
        expect(() =>
            testPaymentCustomerIds(Array.from({ length: 101 }, (_, i) => String(i)).join(',')),
        ).toThrow();
        expect(testPaymentCustomerIds('T_7， T_8, T_7')).toEqual(['T_7', 'T_8']);
    });
});
