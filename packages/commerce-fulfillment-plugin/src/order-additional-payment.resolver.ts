import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';
import { gql } from 'graphql-tag';

import { OrderAdditionalPaymentService } from './order-additional-payment.service';

export const orderAdditionalPaymentShopSchema = gql`
    type OrderAdditionalPaymentQuote {
        orderId: ID!
        state: String!
        outstandingAmount: Money!
        blockedReason: String
        methods: [PaymentMethodQuote!]!
        walletAvailableAmount: Money!
        usdtPayment: StorefrontUsdtCheckoutQuote
    }
    input ModifiedOrderUsdtQuoteInput {
        orderId: ID!
        confirmationToken: String
        expectedAmount: Money!
    }
    input ModifiedOrderBalanceInput {
        orderId: ID!
        expectedAmount: Money!
        amount: Money!
        idempotencyKey: String!
    }
    input OrderAdditionalPaymentInput {
        orderId: ID!
        confirmationToken: String
        expectedAmount: Money!
        payment: PaymentInput!
    }
    extend type Query {
        orderAdditionalPaymentQuote(orderId: ID!, confirmationToken: String): OrderAdditionalPaymentQuote!
    }
    extend type Mutation {
        addPaymentToModifiedOrder(input: OrderAdditionalPaymentInput!): AddPaymentToOrderResult!
        createModifiedOrderUsdtQuote(input: ModifiedOrderUsdtQuoteInput!): StorefrontUsdtCheckoutQuote!
        useModifiedOrderReferralBalance(input: ModifiedOrderBalanceInput!): Order!
    }
`;

@Resolver()
export class OrderAdditionalPaymentShopResolver {
    constructor(private readonly payments: OrderAdditionalPaymentService) {}
    @Query()
    @Allow(Permission.Public)
    orderAdditionalPaymentQuote(
        @Ctx() ctx: RequestContext,
        @Args('orderId') id: ID,
        @Args('confirmationToken') token?: string,
    ) {
        return this.payments.quote(ctx, id, token);
    }

    @Mutation()
    @Transaction('manual')
    @Allow(Permission.Public)
    addPaymentToModifiedOrder(
        @Ctx() ctx: RequestContext,
        @Args('input')
        input: {
            orderId: ID;
            confirmationToken?: string;
            expectedAmount: number;
            payment: PaymentInput;
        },
    ) {
        return this.payments.pay(ctx, input);
    }

    @Mutation()
    @Transaction('manual')
    @Allow(Permission.Public)
    createModifiedOrderUsdtQuote(
        @Ctx() ctx: RequestContext,
        @Args('input')
        input: {
            orderId: ID;
            confirmationToken?: string;
            expectedAmount: number;
        },
    ) {
        return this.payments.usdtQuote(ctx, input);
    }

    @Mutation()
    @Transaction('manual')
    @Allow(Permission.Authenticated)
    useModifiedOrderReferralBalance(
        @Ctx() ctx: RequestContext,
        @Args('input')
        input: {
            orderId: ID;
            expectedAmount: number;
            amount: number;
            idempotencyKey: string;
        },
    ) {
        return this.payments.useBalance(ctx, input);
    }
}
