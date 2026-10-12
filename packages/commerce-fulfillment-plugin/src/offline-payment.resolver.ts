import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    Payment,
    PaymentMethod,
    Permission,
    RequestContext,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';
import { sensitiveStoreFinancePermission } from '@vendure/store-management-plugin';
import { gql } from 'graphql-tag';

import { OFFLINE_MANUAL_HANDLER } from './offline-manual-payment';
import { ConfirmOfflinePaymentInput, OfflinePaymentService } from './offline-payment.service';

const kindTypes = gql`
    enum CommercePaymentKind {
        OFFLINE_MANUAL
        CONTROLLED_TEST
        INTERNAL_TEST
        BALANCE
        EXTERNAL
    }
`;
export const offlineShopSchema = gql`
    ${kindTypes}
    extend type PaymentMethodQuote {
        kind: CommercePaymentKind!
    }
    extend type Payment {
        kind: CommercePaymentKind!
    }
`;
export const offlineAdminSchema = gql`
    ${kindTypes}
    extend type PaymentMethod {
        kind: CommercePaymentKind!
    }
    extend type Payment {
        kind: CommercePaymentKind!
    }
    type OfflineOrderRecovery {
        sourceOrderId: ID!
        sourceOrderCode: String!
        draftOrderId: ID
        draftOrderCode: String
        stage: String!
        quoteHash: String
        originalTotal: Money!
        quotedTotal: Money
        currencyCode: CurrencyCode!
        changes: [String!]!
        blockedReason: String
    }
    input ConfirmOfflinePaymentInput {
        paymentId: ID!
        expectedAmount: Money!
        transactionId: String!
        evidenceReference: String!
        receivedAt: DateTime!
        idempotencyKey: String!
        note: String
    }
    input PrepareLegacyOfflineOrderInput {
        sourceOrderId: ID!
        idempotencyKey: String!
    }
    input SubmitLegacyOfflineOrderInput {
        sourceOrderId: ID!
        quoteHash: String!
        method: String!
        idempotencyKey: String!
    }
    extend type Query {
        offlineOrderRecovery(sourceOrderId: ID!): OfflineOrderRecovery!
    }
    extend type Mutation {
        confirmOfflinePayment(input: ConfirmOfflinePaymentInput!): Payment!
        retryOfflinePaymentReview(paymentId: ID!): Payment!
        prepareOfflinePaymentRefund(paymentId: ID!): Payment!
        prepareLegacyOfflineOrder(input: PrepareLegacyOfflineOrderInput!): OfflineOrderRecovery!
        submitLegacyOfflineOrder(input: SubmitLegacyOfflineOrderInput!): OfflineOrderRecovery!
    }
`;

export function commercePaymentKind(handler: string): string {
    if (handler === OFFLINE_MANUAL_HANDLER) return 'OFFLINE_MANUAL';
    if (handler === 'controlled-test-payment-handler') return 'CONTROLLED_TEST';
    if (handler === 'dummy-payment-handler') return 'INTERNAL_TEST';
    if (handler === 'referral-balance-payment') return 'BALANCE';
    return 'EXTERNAL';
}
@Resolver('PaymentMethod')
export class PaymentMethodKindResolver {
    @ResolveField()
    @Allow(Permission.ReadPaymentMethod, Permission.ReadSettings)
    kind(@Parent() method: PaymentMethod) {
        return commercePaymentKind(method.handler.code);
    }
}
@Resolver('PaymentMethodQuote')
export class PaymentQuoteKindResolver {
    constructor(private readonly connection: TransactionalConnection) {}
    @ResolveField()
    @Allow(Permission.Owner)
    async kind(@Ctx() ctx: RequestContext, @Parent() quote: { code: string }) {
        const method = await this.connection
            .getRepository(ctx, PaymentMethod)
            .findOne({ where: { code: quote.code } });
        return commercePaymentKind(method?.handler.code ?? '');
    }
}
@Resolver('Payment')
export class PaymentKindResolver {
    constructor(private readonly connection: TransactionalConnection) {}
    @ResolveField()
    @Allow(Permission.ReadOrder, Permission.Owner)
    async kind(@Ctx() ctx: RequestContext, @Parent() payment: Payment) {
        // Historical evidence remains classified even if an administrator changes a saved handler later.
        if (payment.metadata?.public?.testPayment === true || payment.state === 'TestSettled')
            return 'CONTROLLED_TEST';
        if (payment.metadata?.offlineManual?.kind === 'OFFLINE_MANUAL') return 'OFFLINE_MANUAL';
        const method = await this.connection
            .getRepository(ctx, PaymentMethod)
            .findOne({ where: { code: payment.method } });
        return commercePaymentKind(method?.handler.code ?? '');
    }
}
@Resolver()
export class OfflinePaymentAdminResolver {
    constructor(private readonly offline: OfflinePaymentService) {}
    @Query()
    @Allow(Permission.ReadOrder)
    offlineOrderRecovery(@Ctx() ctx: RequestContext, @Args('sourceOrderId') sourceOrderId: string) {
        return this.offline.recovery(ctx, sourceOrderId);
    }
    @Mutation()
    @Transaction('manual')
    @Allow(sensitiveStoreFinancePermission.Permission)
    confirmOfflinePayment(@Ctx() ctx: RequestContext, @Args('input') input: ConfirmOfflinePaymentInput) {
        return this.offline.confirm(ctx, input);
    }
    @Mutation()
    @Transaction('manual')
    @Allow(sensitiveStoreFinancePermission.Permission)
    retryOfflinePaymentReview(@Ctx() ctx: RequestContext, @Args('paymentId') paymentId: string) {
        return this.offline.retryReview(ctx, paymentId);
    }
    @Mutation()
    @Transaction('manual')
    @Allow(sensitiveStoreFinancePermission.Permission)
    prepareOfflinePaymentRefund(@Ctx() ctx: RequestContext, @Args('paymentId') paymentId: string) {
        return this.offline.prepareRefund(ctx, paymentId);
    }
    @Mutation()
    @Transaction('manual')
    @Allow(sensitiveStoreFinancePermission.Permission)
    prepareLegacyOfflineOrder(
        @Ctx() ctx: RequestContext,
        @Args('input') input: { sourceOrderId: string; idempotencyKey: string },
    ) {
        return this.offline.prepare(ctx, input);
    }
    @Mutation()
    @Transaction('manual')
    @Allow(sensitiveStoreFinancePermission.Permission)
    submitLegacyOfflineOrder(
        @Ctx() ctx: RequestContext,
        @Args('input')
        input: { sourceOrderId: string; quoteHash: string; method: string; idempotencyKey: string },
    ) {
        return this.offline.submit(ctx, input);
    }
}
export const offlineAdminResolvers = [
    OfflinePaymentAdminResolver,
    PaymentMethodKindResolver,
    PaymentKindResolver,
];
export const offlineShopResolvers = [PaymentQuoteKindResolver, PaymentKindResolver];
