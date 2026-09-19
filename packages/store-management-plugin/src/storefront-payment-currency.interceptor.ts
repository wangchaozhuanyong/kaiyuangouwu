import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
    internal_getRequestContext,
    Order,
    parseContext,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { map } from 'rxjs/operators';

import { orderPaymentCurrencyCode, paymentMethodMatchesCurrency } from './payment-currency';

interface PaymentMethodView {
    code?: string;
}

@Injectable()
export class StorefrontPaymentCurrencyInterceptor implements NestInterceptor {
    constructor(private readonly connection: TransactionalConnection) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL || !['Query', 'Mutation'].includes(parsed.info.parentType.name)) {
            return next.handle();
        }
        const ctx = internal_getRequestContext(parsed.req, context);
        if (ctx.apiType !== 'shop') return next.handle();

        const field = parsed.info.fieldName;
        const args = GqlExecutionContext.create(context).getArgs<Record<string, unknown>>();
        if (field === 'setOrderCustomFields' && attemptsPaymentCurrencyWrite(args)) {
            throw new UserInputError('请通过付款币种切换接口更新订单币种');
        }
        if (field !== 'eligiblePaymentMethods' && field !== 'addPaymentToOrder') {
            return next.handle();
        }

        const order = await this.activeOrder(ctx);
        if (!order) return next.handle();
        const paymentCurrencyCode = orderPaymentCurrencyCode(order);

        if (field === 'addPaymentToOrder') {
            const method = paymentMethodFromArgs(args);
            if (method && !paymentMethodMatchesCurrency(paymentCurrencyCode, method)) {
                throw new UserInputError(
                    paymentCurrencyCode === 'USDT'
                        ? '当前订单已选择 USDT 付款，请使用 USDT-TRC20 完成付款'
                        : '当前订单未选择 USDT 付款，请先切换付款币种',
                );
            }
            return next.handle();
        }

        return next
            .handle()
            .pipe(
                map(result =>
                    Array.isArray(result)
                        ? result.filter(
                              (method: PaymentMethodView) =>
                                  typeof method.code !== 'string' ||
                                  paymentMethodMatchesCurrency(paymentCurrencyCode, method.code),
                          )
                        : result,
                ),
            );
    }

    private async activeOrder(ctx: RequestContext) {
        const activeOrderId = ctx.session?.activeOrderId;
        if (!activeOrderId) return null;
        return this.connection.getRepository(ctx, Order).findOne({ where: { id: activeOrderId } });
    }
}

function paymentMethodFromArgs(args: Record<string, unknown>): string | null {
    const input = args.input;
    if (!input || typeof input !== 'object') return null;
    const method = (input as Record<string, unknown>).method;
    return typeof method === 'string' ? method : null;
}

function attemptsPaymentCurrencyWrite(args: Record<string, unknown>): boolean {
    const input = args.input;
    if (!input || typeof input !== 'object') return false;
    const customFields = (input as Record<string, unknown>).customFields;
    return Boolean(
        customFields &&
        typeof customFields === 'object' &&
        Object.prototype.hasOwnProperty.call(customFields, 'paymentCurrencyCode'),
    );
}
