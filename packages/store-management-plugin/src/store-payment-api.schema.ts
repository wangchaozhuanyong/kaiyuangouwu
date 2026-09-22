import { gql } from 'graphql-tag';

export const storePaymentApiSchema = gql`
    type StoreUsdtPaymentIntent {
        id: ID!
        channelId: ID!
        channelCode: String!
        orderId: ID!
        orderCode: String!
        network: String!
        fiatCurrencyCode: String!
        fiatAmount: Money!
        fiatPerUsdtRate: Float!
        markupPercent: Float!
        rateSource: String!
        receivingAddressMasked: String!
        receivingAddressFingerprint: String!
        baseUsdtAmount: Float!
        expectedUsdtAmount: Float!
        receivedUsdtAmount: Float
        senderAddressMasked: String
        status: String!
        transactionId: String
        failureReason: String
        createdAt: DateTime!
        expiresAt: DateTime!
        settledAt: DateTime
        blockNumber: Int
        blockTimestamp: DateTime
        lastCheckedAt: DateTime
        manualReviewCode: String
        resolvedAt: DateTime
        resolvedByUserId: ID
        resolutionActionId: ID
    }

    type StoreUsdtWallet {
        channelId: ID!
        channelCode: String!
        reviewStatus: String!
        configured: Boolean!
        network: String!
        activeReceivingAddressMasked: String
        activeReceivingAddressFingerprint: String
        pendingReceivingAddress: String
        pendingReceivingAddressFingerprint: String
        canReview: Boolean!
        submittedAt: DateTime
        reviewedAt: DateTime
        rejectionReason: String
    }

    type StoreUsdtFiatTotal {
        currencyCode: String!
        amount: Money!
    }

    type StoreUsdtChannelPaymentStats {
        channelId: ID!
        channelCode: String!
        totalCount: Int!
        pendingCount: Int!
        settledCount: Int!
        manualReviewCount: Int!
        expiredCount: Int!
        resolvedCount: Int!
        expectedUsdtTotal: Float!
        receivedUsdtTotal: Float!
        fiatTotals: [StoreUsdtFiatTotal!]!
    }

    type StorePaymentMethodStats {
        channelId: ID!
        channelCode: String!
        paymentMethodCode: String!
        currencyCode: CurrencyCode!
        settledCount: Int!
        refundCount: Int!
        grossAmount: Money!
        refundedAmount: Money!
        netAmount: Money!
    }

    type StorePaymentDetail {
        id: ID!
        channelId: ID!
        channelCode: String!
        orderId: ID!
        orderCode: String!
        paymentMethodCode: String!
        paymentState: String!
        currencyCode: CurrencyCode!
        amount: Money!
        refundedAmount: Money!
        netAmount: Money!
        transactionId: String
        createdAt: DateTime!
    }

    input StorePaymentReportOptionsInput {
        from: DateTime
        to: DateTime
        skip: Int
        take: Int
    }

    type StorePaymentDetailList {
        items: [StorePaymentDetail!]!
        totalItems: Int!
    }

    input StoreUsdtManualRefundInput {
        paymentId: ID!
        amount: Money!
        usdtAmount: String!
        recipientAddress: String!
        transactionId: String!
        reason: String!
    }

    type StoreUsdtManualRefund {
        id: ID!
        refundId: ID!
        channelId: ID!
        channelCode: String!
        paymentId: ID!
        orderId: ID!
        orderCode: String!
        currencyCode: CurrencyCode!
        amount: Money!
        usdtAmount: String!
        network: String!
        transactionId: String!
        fromAddress: String!
        toAddress: String!
        blockNumber: Int!
        blockTimestamp: DateTime!
        reason: String!
        operatorUserId: ID!
        state: String!
        createdAt: DateTime!
    }

    type StoreUsdtManualRefundList {
        items: [StoreUsdtManualRefund!]!
        totalItems: Int!
    }
`;
