// organize-imports-ignore -- Keep ESLint's payment/ before payment-method/ order stable during formatting.
import { LanguageCode } from '@vendure/common/lib/generated-types';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { usdtTrc20PaymentHandler } from '../../../../store-management-plugin/src/usdt/usdt-payment-handler';
import {
    configureUsdtPaymentProofSecret,
    createUsdtPaymentProof,
} from '../../../../store-management-plugin/src/usdt/usdt-payment-proof';
import { PaymentMethodHandler } from '../../config/payment/payment-method-handler';
import { Order } from '../../entity/order/order.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { PaymentMethod } from '../../entity/payment-method/payment-method.entity';
import { StorePaymentMethodState } from '../../entity/payment-method/store-payment-method-state.entity';

import { OrderService } from './order.service';
import {
    AcceptedPaymentIntent,
    paymentHandlerArgumentsHash,
    PaymentMethodService,
} from './payment-method.service';
import { PaymentService } from './payment.service';

function setup(platformEnabled = false, storeEnabled = false, actualHandler?: PaymentMethodHandler) {
    const ctx = { channelId: 'store-1', channel: { id: 'store-1', code: 'store-1' } } as any;
    const order = {
        id: 'order-1',
        salesChannelId: ctx.channelId,
        state: 'ArrangingPayment',
        totalWithTax: 1000,
        currencyCode: 'CNY',
        payments: [],
        lines: [],
    } as unknown as Order;
    const method = {
        id: 'method-1',
        code: 'usdt-trc20',
        enabled: platformEnabled,
        handler: { code: 'usdt-trc20-chain-handler', args: [] },
        checker: null,
    } as unknown as PaymentMethod;
    let deleted = false;
    const provider = vi.fn((_ctx, _order, amount) => ({ state: 'Settled' as const, amount }));
    const handler =
        actualHandler ??
        new PaymentMethodHandler({
            code: method.handler.code,
            description: [{ languageCode: LanguageCode.en, value: 'USDT' }],
            args: {},
            createPayment: provider,
            settlePayment: () => ({ success: true }),
        });
    const query = {
        relation: vi.fn().mockReturnThis(),
        of: vi.fn().mockReturnThis(),
        add: vi.fn().mockResolvedValue(undefined),
    };
    const methodRepository = {
        findOne: vi.fn(({ where }) =>
            Promise.resolve(
                !deleted && where.code === method.code && where.channels.id === 'platform' ? method : null,
            ),
        ),
        find: vi.fn(() => Promise.resolve(!deleted && method.enabled ? [method] : [])),
    };
    const save = vi.fn((payment: Payment) => Promise.resolve(Object.assign(payment, { id: 'payment-1' })));
    const connection = {
        platformStoreGovernanceEnabled: true,
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === PaymentMethod) return methodRepository;
            if (entity === StorePaymentMethodState)
                return {
                    find: () => Promise.resolve(storeEnabled ? [{ paymentMethodId: method.id }] : []),
                };
            return { save, createQueryBuilder: () => query };
        }),
        withTransaction: vi.fn((_ctx, work) => work(ctx)),
    };
    const methods = new PaymentMethodService(
        connection as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { getByCode: () => handler } as any,
        { getDefaultChannel: () => Promise.resolve({ id: 'platform' }) } as any,
        {} as any,
        {} as any,
        { translate: (value: unknown) => value } as any,
    );
    const payments = new PaymentService(
        connection as any,
        {
            transition: (_ctx: unknown, _order: unknown, payment: Payment, state: Payment['state']) => {
                payment.state = state;
                return Promise.resolve({ finalize: () => Promise.resolve() });
            },
        } as any,
        {} as any,
        methods,
        { publish: () => Promise.resolve() } as any,
    );
    const validators = new Map();
    const lock = vi.fn().mockResolvedValue(undefined);
    const coupons = vi.fn().mockResolvedValue([]);
    const orders = Object.assign(Object.create(OrderService.prototype), {
        connection,
        paymentService: payments,
        checkoutValidators: validators,
        assertInTransaction: vi.fn(),
        lockOrderForRefund: lock,
        getOrderOrThrow: vi.fn().mockResolvedValue(order),
        canAddPaymentToOrder: () => true,
        revalidateCouponCodesForOrder: coupons,
        getOrderPayments: () => Promise.resolve([]),
        findOne: () => Promise.resolve(order),
    }) as OrderService;
    const scope: AcceptedPaymentIntent = {
        channelId: ctx.channelId,
        orderId: order.id,
        method: method.code,
        paymentMethodId: method.id,
        handlerCode: method.handler.code,
        handlerArgumentsHash: paymentHandlerArgumentsHash(method.handler.args),
        amount: order.totalWithTax,
        currencyCode: order.currencyCode,
    };
    return {
        ctx,
        order,
        method,
        methods,
        payments,
        orders,
        scope,
        provider,
        save,
        validators,
        lock,
        coupons,
        deleteMethod: () => {
            deleted = true;
        },
    };
}

describe('accepted payment intent internal settlement', () => {
    it.each([
        [false, true],
        [true, false],
        [false, false],
    ])(
        'settles only the accepted scope with platform=%s and store=%s; ordinary calls stay blocked',
        async (platform, store) => {
            const test = setup(platform, store);
            await expect(
                test.orders.addPaymentToOrderFromAcceptedIntent(test.ctx, test.scope, {}),
            ).resolves.toBe(test.order);
            expect(test.provider).toHaveBeenCalledOnce();
            expect(test.lock).toHaveBeenCalled();
            expect(test.coupons).toHaveBeenCalled();
            await expect(
                test.orders.addPaymentToOrder(test.ctx, test.order.id, {
                    method: test.scope.method,
                    metadata: { existingPayment: true, acceptedIntent: test.scope, proof: 'client-flag' },
                }),
            ).rejects.toThrow();
            expect(test.provider).toHaveBeenCalledOnce();
        },
    );

    it.each([
        'channel',
        'order',
        'method',
        'method-id',
        'handler',
        'args',
        'deleted',
        'amount',
        'currency',
    ] as const)('rejects a changed or mismatched %s before creating a payment', async mismatch => {
        const test = setup();
        if (mismatch === 'channel') test.scope.channelId = 'store-2';
        if (mismatch === 'order') test.scope.orderId = 'order-2';
        if (mismatch === 'method') test.scope.method = 'another-method';
        if (mismatch === 'method-id') test.method.id = 'replacement-method';
        if (mismatch === 'handler') test.method.handler.code = 'replacement-handler';
        if (mismatch === 'args') test.method.handler.args = [{ name: 'destination', value: 'changed' }];
        if (mismatch === 'deleted') test.deleteMethod();
        if (mismatch === 'amount') Object.assign(test.order, { totalWithTax: 1100 });
        if (mismatch === 'currency') test.scope.currencyCode = 'USD';
        await expect(
            test.orders.addPaymentToOrderFromAcceptedIntent(test.ctx, test.scope, {}),
        ).rejects.toThrow();
        expect(test.provider).not.toHaveBeenCalled();
        expect(test.save).not.toHaveBeenCalled();
    });

    it('keeps checkout validation and price revalidation before accepted settlement', async () => {
        const test = setup();
        test.validators.set('quote-validation', () => Promise.resolve({ error: 'Quote no longer valid' }));
        const result = await test.orders.addPaymentToOrderFromAcceptedIntent(test.ctx, test.scope, {});
        expect(result).toMatchObject({
            errorCode: 'PAYMENT_FAILED_ERROR',
            paymentErrorMessage: 'Quote no longer valid',
        });
        expect(test.provider).not.toHaveBeenCalled();
        test.validators.set('quote-validation', () => {
            Object.assign(test.order, { totalWithTax: 1200 });
            return Promise.resolve({});
        });
        await expect(
            test.orders.addPaymentToOrderFromAcceptedIntent(test.ctx, test.scope, {}),
        ).rejects.toThrow();
        expect(test.provider).not.toHaveBeenCalled();
    });

    it('runs the real USDT proof handler after both switches turn off, while a client proof stays on the ordinary path', async () => {
        configureUsdtPaymentProofSecret('isolated-accepted-intent-proof-secret-long-enough');
        const test = setup(false, false, usdtTrc20PaymentHandler as unknown as PaymentMethodHandler);
        Object.assign(test.order, { customFields: { paymentCurrencyCode: 'USDT' } });
        const proof = createUsdtPaymentProof({
            channelId: String(test.ctx.channelId),
            orderId: String(test.order.id),
            quoteId: 'quote-1',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 1000,
            transactionId: 'a'.repeat(64),
            usdtAmount: '13.850123',
            receivingAddressFingerprint: 'b'.repeat(64),
            expiresAt: Date.now() + 60_000,
        });
        await test.orders.addPaymentToOrderFromAcceptedIntent(test.ctx, test.scope, { proof });
        expect(test.save.mock.calls[0][0]).toMatchObject({
            state: 'Settled',
            amount: 1000,
            transactionId: `tron:${'a'.repeat(64)}`,
        });
        await expect(
            test.orders.addPaymentToOrder(test.ctx, test.order.id, {
                method: test.scope.method,
                metadata: { proof, acceptedIntent: test.scope, existingPayment: true },
            }),
        ).rejects.toThrow();
        expect(test.save).toHaveBeenCalledTimes(2);
    });
});
