import {
    ConfigService,
    FulfillmentProcess,
    ID,
    Injector,
    LanguageCode,
    Order,
    OrderProcess,
    PaymentMethod,
    PaymentMethodEligibilityChecker,
    PaymentMethodHandler,
    PaymentMethodService,
    PaymentProcess,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { totalCoveredByPayments } from '@vendure/core/dist/service/helpers/utils/order-utils';
import {
    controlledTestPaymentScopeMatchesOrder,
    StorefrontCartService,
    testPaymentArguments,
} from '@vendure/storefront-cart-plugin';
import { randomUUID } from 'node:crypto';

declare module '@vendure/core/dist/service/helpers/payment-state-machine/payment-state' {
    interface PaymentStates {
        TestSettled: never;
    }
}

declare module '@vendure/core/dist/service/helpers/order-state-machine/order-state' {
    interface OrderStates {
        TestPaymentSettled: never;
    }
}

export const CONTROLLED_TEST_PAYMENT_HANDLER = 'controlled-test-payment-handler';
export const CONTROLLED_TEST_PAYMENT_CHECKER = 'controlled-test-payment-checker';
export const CONTROLLED_TEST_PAYMENT_PREFIX = 'controlled-test-payment-';

/** Simulate the server-calculated payment while using the normal paid-order workflow. */
export function createControlledTestPayment(enabled: boolean) {
    let connection: TransactionalConnection;
    let config: ConfigService;
    let carts: StorefrontCartService;
    let methods: PaymentMethodService;
    const init = (injector: Injector) => {
        connection = injector.get(TransactionalConnection);
        config = injector.get(ConfigService);
        carts = injector.get(StorefrontCartService);
        methods = injector.get(PaymentMethodService);
    };

    const lockPayableOrder = async (ctx: RequestContext, orderId: ID): Promise<boolean> => {
        await carts.lockForOrder(ctx, orderId);
        // UPDATE evaluates the current committed row even under MySQL REPEATABLE READ.
        // A SELECT after waiting for the lock can still return the transaction's older snapshot.
        const result = await connection
            .getRepository(ctx, Order)
            .update({ id: orderId, active: true, state: 'ArrangingPayment' }, { id: orderId });
        return result.affected === 1;
    };

    async function payableOrder(
        ctx: RequestContext,
        orderId: ID,
        method: PaymentMethod,
        locked = false,
    ): Promise<Order | undefined> {
        if (!enabled || ctx.apiType !== 'shop') return;
        const lock =
            locked && !['sqljs', 'sqlite', 'better-sqlite3'].includes(connection.rawConnection?.options?.type)
                ? { mode: 'pessimistic_write' as const }
                : undefined;
        const currentMethod = (await methods.getActivePaymentMethods(ctx)).find(
            m => String(m.id) === String(method.id),
        );
        if (
            !currentMethod ||
            currentMethod.handler.code !== CONTROLLED_TEST_PAYMENT_HANDLER ||
            currentMethod.checker?.code !== CONTROLLED_TEST_PAYMENT_CHECKER
        )
            return;
        const args = testPaymentArguments(currentMethod);
        // Platform scopes are checked against the sales order in the current shop. Legacy per-shop codes
        // never become a global template implicitly.
        if (currentMethod.code !== `${CONTROLLED_TEST_PAYMENT_PREFIX}platform`) return;
        // A joined locking read avoids stale payment totals under MySQL REPEATABLE READ.
        const order = await connection.findOneInChannel(ctx, Order, orderId, ctx.channelId, {
            relations: ['payments', 'payments.refunds', 'lines', 'lines.productVariant'],
            relationLoadStrategy: 'join',
            lock,
        });
        if (!order?.active || order.state !== 'ArrangingPayment') return;
        if (!controlledTestPaymentScopeMatchesOrder(args, order)) return;
        const amount = order.totalWithTax - totalCoveredByPayments(order);
        if (!Number.isSafeInteger(amount) || amount < 0) return;
        return order;
    }

    const checker = new PaymentMethodEligibilityChecker({
        code: CONTROLLED_TEST_PAYMENT_CHECKER,
        description: [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '按本店支付配置向所有订单或指定测试订单开放模拟支付',
            },
        ],
        args: {},
        init,
        check: async (ctx, order, _args, method) => Boolean(await payableOrder(ctx, order.id, method)),
    });

    const handler = new PaymentMethodHandler({
        code: CONTROLLED_TEST_PAYMENT_HANDLER,
        description: [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '测试支付：按订单应付金额模拟付款成功，进入正常已付款订单流程，无需真实转账',
            },
        ],
        args: {
            channelId: {
                type: 'string',
                required: true,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '配置渠道 ID（平台统一配置）' }],
            },
            allowAllOrders: {
                type: 'boolean',
                required: false,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '允许本店所有订单使用模拟支付' }],
            },
            orderCode: {
                type: 'string',
                required: false,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '仅允许模拟支付的订单号（建立订单后填写）' },
                ],
            },
            qaSku: {
                type: 'string',
                required: false,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '本次测试商品 SKU' }],
            },
            qaMarker: {
                type: 'string',
                required: false,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '本次订单备注（完整一致）' }],
            },
        },
        init,
        createPayment: async (ctx, order, amount, _args, _metadata, method) => {
            const current = await payableOrder(ctx, order.id, method);
            if (!current || amount !== current.totalWithTax - totalCoveredByPayments(current)) {
                throw new UserInputError('测试支付未开启或订单应付金额已变化，请重新加载订单');
            }
            return {
                amount,
                state: 'Settled',
                transactionId: `test-${randomUUID()}`,
                metadata: { public: { testPayment: true, message: '测试支付成功，未发生真实转账' } },
            };
        },
        settlePayment: () => ({ success: true }),
        cancelPayment: () => ({ success: true }),
        createRefund: () => {
            throw new UserInputError('测试支付没有真实款项，不能退款');
        },
    });

    const paymentProcess: PaymentProcess<'TestSettled'> = {
        init,
        // Keep historical test payments terminal; new payments use the standard Settled state.
        transitions: { TestSettled: { to: [] } },
        async onTransitionStart(from, to, { ctx, order, payment }) {
            if (from === 'TestSettled' || to === 'TestSettled') return '历史测试支付不能转为真实付款';
            if (!payment.method.startsWith(CONTROLLED_TEST_PAYMENT_PREFIX) || to !== 'Settled') return;
            if (from !== 'Created' || !(await lockPayableOrder(ctx, order.id)))
                return '测试订单已完成或已不允许付款';
            const method = await connection.getRepository(ctx, PaymentMethod).findOne({
                where: { code: payment.method },
            });
            const current = method && (await payableOrder(ctx, order.id, method, true));
            if (!current || payment.amount !== current.totalWithTax - totalCoveredByPayments(current)) {
                return '测试支付条件或应付金额已变化，请重新加载订单';
            }
        },
    };

    const orderProcess: OrderProcess<'TestPaymentSettled'> = {
        // Preserve old records without reactivating them or giving them a fulfillment path.
        transitions: { TestPaymentSettled: { to: [] } },
        onTransitionStart(from, to) {
            if (from === 'TestPaymentSettled' || to === 'TestPaymentSettled')
                return '历史测试订单已结束，不能重新付款或发货';
        },
    };
    const fulfillmentProcess: FulfillmentProcess<string> = {
        onTransitionStart(_from, _to, { orders: fulfillmentOrders }) {
            if (fulfillmentOrders.some(order => order.state === 'TestPaymentSettled')) {
                return '测试订单不能创建真实交付或扣减库存';
            }
        },
    };
    return { handler, checker, paymentProcess, orderProcess, fulfillmentProcess };
}
