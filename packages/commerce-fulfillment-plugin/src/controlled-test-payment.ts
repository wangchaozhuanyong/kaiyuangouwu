import {
    ConfigService,
    Customer,
    FulfillmentProcess,
    ID,
    Injector,
    isGraphQlErrorResult,
    LanguageCode,
    Order,
    OrderProcess,
    OrderService,
    PaymentMethod,
    PaymentMethodEligibilityChecker,
    PaymentMethodHandler,
    PaymentProcess,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { StorefrontCartLifecycleService, StorefrontCartService } from '@vendure/storefront-cart-plugin';
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

export function testPaymentCustomerIds(value: string): string[] {
    const ids = [
        ...new Set(
            value
                .trim()
                .split(/[,，\s]+/u)
                .filter(Boolean),
        ),
    ];
    if (!ids.length || ids.length > 100 || ids.some(id => !/^[\w-]{1,128}$/u.test(id))) {
        throw new UserInputError('请填写 1 至 100 个测试客户 ID，以逗号分隔');
    }
    return ids;
}

export function testPaymentArguments(method: PaymentMethod) {
    return Object.fromEntries(
        method.handler.args.map(arg => {
            // Next Admin serializes text arguments as JSON strings; the standard API also accepts raw text.
            let value = String(arg.value);
            try {
                const parsed: unknown = JSON.parse(value);
                if (typeof parsed === 'string') value = parsed;
            } catch {
                /* Raw configurable-operation text. */
            }
            return [arg.name, value];
        }),
    );
}

/** A distinct terminal state deliberately never emits a real settled/placed event. */
export function createControlledTestPayment(enabled: boolean) {
    let connection: TransactionalConnection;
    let config: ConfigService;
    let orders: OrderService;
    let carts: StorefrontCartService;
    let lifecycle: StorefrontCartLifecycleService;
    const init = (injector: Injector) => {
        connection = injector.get(TransactionalConnection);
        config = injector.get(ConfigService);
        orders = injector.get(OrderService);
        carts = injector.get(StorefrontCartService);
        lifecycle = injector.get(StorefrontCartLifecycleService);
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

    async function eligible(ctx: RequestContext, orderId: ID, method: PaymentMethod): Promise<boolean> {
        if (!enabled || ctx.apiType !== 'shop' || !ctx.activeUserId) return false;
        const currentMethod = await connection.findOneInChannel(ctx, PaymentMethod, method.id, ctx.channelId);
        if (!currentMethod?.enabled || currentMethod.handler.code !== CONTROLLED_TEST_PAYMENT_HANDLER)
            return false;
        const args = testPaymentArguments(currentMethod);
        if (
            args.channelId !==
                String(
                    (config.entityOptions.entityIdStrategy ?? config.entityIdStrategy).encodeId(
                        ctx.channelId,
                    ),
                ) ||
            currentMethod.code !== `${CONTROLLED_TEST_PAYMENT_PREFIX}${args.channelId}` ||
            currentMethod.checker?.code !== CONTROLLED_TEST_PAYMENT_CHECKER
        )
            return false;
        let customerIds: string[];
        try {
            customerIds = testPaymentCustomerIds(args.customerIds ?? '');
        } catch {
            return false;
        }
        const order = await connection.findOneInChannel(ctx, Order, orderId, ctx.channelId, {
            relations: ['customer', 'customer.user', 'payments'],
        });
        if (
            !order?.active ||
            order.state !== 'ArrangingPayment' ||
            order.totalWithTax <= 0 ||
            !order.customer?.user ||
            order.customer.user.deletedAt ||
            !order.customer.user.verified ||
            String(order.customer.user.id) !== String(ctx.activeUserId) ||
            !customerIds.includes(
                String(
                    (config.entityOptions.entityIdStrategy ?? config.entityIdStrategy).encodeId(
                        order.customer.id,
                    ),
                ),
            ) ||
            order.couponCodes.length ||
            order.payments.some(payment => !['Declined', 'Error', 'Cancelled'].includes(payment.state))
        )
            return false;
        // Membership must be checked separately: default-channel orders can refer to other stores' customers.
        return Boolean(await connection.findOneInChannel(ctx, Customer, order.customer.id, ctx.channelId));
    }

    const checker = new PaymentMethodEligibilityChecker({
        code: CONTROLLED_TEST_PAYMENT_CHECKER,
        description: [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '仅允许本店指定的已登录测试客户，不支持优惠券或混合付款',
            },
        ],
        args: {},
        init,
        check: (ctx, order, _args, method) => eligible(ctx, order.id, method),
    });

    const handler = new PaymentMethodHandler({
        code: CONTROLLED_TEST_PAYMENT_HANDLER,
        description: [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '受控测试支付：不扣款、不发货、不扣库存、不计收入和返利',
            },
        ],
        args: {
            channelId: {
                type: 'string',
                required: true,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '本店 Channel ID' }],
            },
            customerIds: {
                type: 'string',
                required: true,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '测试客户 ID（逗号分隔）' }],
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '填写客户管理中的客户 ID；客户必须已注册并验证邮箱',
                    },
                ],
            },
        },
        init,
        createPayment: async (ctx, order, amount, _args, _metadata, method) => {
            if (!(await lockPayableOrder(ctx, order.id)) || !(await eligible(ctx, order.id, method))) {
                throw new UserInputError(
                    '测试支付未开启或当前账号、订单不符合测试条件；不能与余额、USDT 或优惠券混用',
                );
            }
            return {
                amount,
                state: 'TestSettled',
                transactionId: `test-${randomUUID()}`,
                metadata: { public: { testPayment: true, message: '测试成功，未真实扣款或交付商品' } },
            };
        },
        settlePayment: () => ({ success: false, errorMessage: '测试支付不能转为真实结算' }),
        cancelPayment: () => ({ success: false, errorMessage: '测试支付已完成，无真实款项需要撤销' }),
        createRefund: () => {
            throw new UserInputError('测试支付没有真实款项，不能退款');
        },
    });

    const paymentProcess: PaymentProcess<'TestSettled'> = {
        init,
        transitions: { Created: { to: ['TestSettled'] }, TestSettled: { to: [] } },
        async onTransitionStart(from, to, { ctx, order, payment }) {
            if (from === 'TestSettled') return '测试支付不能转为真实付款';
            if (to !== 'TestSettled') return;
            // This hook is inside PaymentService's transaction even for internal callers.
            if (!(await lockPayableOrder(ctx, order.id))) return '测试订单已完成或已不允许付款';
            const method = await connection
                .getRepository(ctx, PaymentMethod)
                .findOne({ where: { code: payment.method } });
            if (
                !method ||
                !(await eligible(ctx, order.id, method)) ||
                payment.amount !== order.totalWithTax
            ) {
                return '测试支付条件已变化，请重新加载订单';
            }
        },
        async onTransitionEnd(_from, to, { ctx, order }) {
            if (to !== 'TestSettled') return;
            const result = await orders.transitionToState(ctx, order.id, 'TestPaymentSettled');
            if (isGraphQlErrorResult(result)) throw new UserInputError(result.message);
        },
    };

    const orderProcess: OrderProcess<'TestPaymentSettled'> = {
        init,
        transitions: { ArrangingPayment: { to: ['TestPaymentSettled'] }, TestPaymentSettled: { to: [] } },
        async onTransitionStart(from, to, { ctx, order }) {
            if (from === 'TestPaymentSettled') return '测试订单已结束，不能转为真实订单或发货';
            if (to !== 'TestPaymentSettled') return;
            if (ctx.apiType !== 'shop' || !ctx.activeUserId || from !== 'ArrangingPayment')
                return '测试订单状态无效';
            const payments = await orders.getOrderPayments(ctx, order.id);
            const successful = payments.filter(
                payment => !['Declined', 'Error', 'Cancelled'].includes(payment.state),
            );
            if (
                successful.length !== 1 ||
                successful[0].state !== 'TestSettled' ||
                successful[0].method !==
                    `${CONTROLLED_TEST_PAYMENT_PREFIX}${(config.entityOptions.entityIdStrategy ?? config.entityIdStrategy).encodeId(ctx.channelId)}` ||
                successful[0].amount !== order.totalWithTax
            )
                return '订单没有有效的测试付款';
        },
        async onTransitionEnd(_from, to, { ctx, order }) {
            if (to !== 'TestPaymentSettled') return;
            order.active = false;
            // Leave orderPlacedAt null: financial and sales queries must not count a simulated order.
            await lifecycle.completeCheckoutForOrder(ctx, order.id);
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
