import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
    ConfigService,
    Customer,
    EventBus,
    PaymentMethod,
    PaymentMethodEvent,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import {
    CONTROLLED_TEST_PAYMENT_CHECKER,
    CONTROLLED_TEST_PAYMENT_HANDLER,
    CONTROLLED_TEST_PAYMENT_PREFIX,
    testPaymentArguments,
    testPaymentCustomerIds,
} from './controlled-test-payment';

@Injectable()
export class ControlledTestPaymentConfigService implements OnApplicationBootstrap {
    constructor(
        private readonly events: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly config: ConfigService,
    ) {}

    onApplicationBootstrap(): void {
        this.events.registerBlockingEventHandler({
            event: PaymentMethodEvent,
            id: 'validate-controlled-test-payment',
            handler: event => this.validate(event),
        });
    }

    async validate({ ctx, entity, type, input }: PaymentMethodEvent): Promise<void> {
        if (type === 'deleted') return;
        // Update events may carry only the patched fields (e.g. an enabled toggle).
        const method = await this.connection.getEntityOrThrow(ctx, PaymentMethod, entity.id, {
            channelId: ctx.channelId,
        });
        if (
            method.handler.code !== CONTROLLED_TEST_PAYMENT_HANDLER &&
            !method.code.startsWith(CONTROLLED_TEST_PAYMENT_PREFIX)
        )
            return;
        const args = testPaymentArguments(method);
        if (method.handler.code !== CONTROLLED_TEST_PAYMENT_HANDLER)
            throw new UserInputError('测试支付必须使用专用测试处理器');
        // The translatable saver can null omitted nullable fields on partial updates.
        // Preserve the mandatory checker on a simple enable/disable toggle; explicit removal is rejected.
        if (
            type === 'updated' &&
            input &&
            typeof input === 'object' &&
            input.checker === undefined &&
            !method.checker
        ) {
            method.checker = { code: CONTROLLED_TEST_PAYMENT_CHECKER, args: [] };
            await this.connection
                .getRepository(ctx, PaymentMethod)
                .update(method.id, { checker: method.checker });
        }
        const channelId = String(
            (this.config.entityOptions.entityIdStrategy ?? this.config.entityIdStrategy).encodeId(
                ctx.channelId,
            ),
        );
        if (args.channelId !== channelId)
            throw new UserInputError(`测试支付的本店 Channel ID 应为 ${channelId}`);
        if (method.code !== `${CONTROLLED_TEST_PAYMENT_PREFIX}${channelId}`)
            throw new UserInputError(
                `本店测试支付的配置代码应为 ${CONTROLLED_TEST_PAYMENT_PREFIX}${channelId}`,
            );
        if (method.checker?.code !== CONTROLLED_TEST_PAYMENT_CHECKER)
            throw new UserInputError('测试支付必须使用测试资格检查器');
        const customerIds = testPaymentCustomerIds(args.customerIds ?? '');
        for (const id of customerIds) {
            const customer = await this.connection.findOneInChannel(
                ctx,
                Customer,
                (this.config.entityOptions.entityIdStrategy ?? this.config.entityIdStrategy).decodeId(id),
                ctx.channelId,
                { relations: ['user'] },
            );
            if (!customer?.user?.verified || customer.user.deletedAt) {
                throw new UserInputError('测试客户必须属于本店，且已注册并验证邮箱');
            }
        }
    }
}
