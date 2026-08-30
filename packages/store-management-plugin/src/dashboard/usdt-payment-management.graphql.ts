import { gql } from 'graphql-tag';

export const platformUsdtPaymentManagementQuery = gql`
    query PlatformUsdtPaymentManagement(
        $channelId: ID
        $statsOptions: StorePaymentReportOptionsInput
        $paymentOptions: StorePaymentReportOptionsInput
        $refundOptions: StorePaymentReportOptionsInput
    ) {
        storeUsdtWallets {
            channelId
            channelCode
            reviewStatus
            configured
            network
            activeReceivingAddressMasked
            activeReceivingAddressFingerprint
            pendingReceivingAddress
            pendingReceivingAddressFingerprint
            submittedAt
            reviewedAt
            rejectionReason
        }
        storeUsdtPaymentStats(channelId: $channelId) {
            channelId
            channelCode
            totalCount
            pendingCount
            settledCount
            manualReviewCount
            expiredCount
            expectedUsdtTotal
            receivedUsdtTotal
            fiatTotals {
                currencyCode
                amount
            }
        }
        storeUsdtPaymentIntents(channelId: $channelId) {
            id
            channelId
            channelCode
            orderId
            orderCode
            network
            fiatCurrencyCode
            fiatAmount
            fiatPerUsdtRate
            markupPercent
            rateSource
            receivingAddressMasked
            receivingAddressFingerprint
            baseUsdtAmount
            expectedUsdtAmount
            receivedUsdtAmount
            senderAddressMasked
            status
            transactionId
            failureReason
            createdAt
            expiresAt
            settledAt
            blockNumber
            blockTimestamp
            lastCheckedAt
        }
        storePaymentStats(channelId: $channelId, options: $statsOptions) {
            channelId
            channelCode
            paymentMethodCode
            currencyCode
            settledCount
            refundCount
            grossAmount
            refundedAmount
            netAmount
        }
        storePaymentDetails(channelId: $channelId, options: $paymentOptions) {
            items {
                id
                channelId
                channelCode
                orderId
                orderCode
                paymentMethodCode
                paymentState
                currencyCode
                amount
                refundedAmount
                netAmount
                transactionId
                createdAt
            }
            totalItems
        }
        storeUsdtManualRefunds(channelId: $channelId, options: $refundOptions) {
            items {
                id
                refundId
                channelId
                channelCode
                paymentId
                orderId
                orderCode
                currencyCode
                amount
                usdtAmount
                network
                transactionId
                fromAddress
                toAddress
                blockNumber
                blockTimestamp
                reason
                operatorUserId
                state
                createdAt
            }
            totalItems
        }
    }
`;

export const reviewStoreUsdtWalletMutation = gql`
    mutation ReviewStoreUsdtWallet($input: ReviewStoreUsdtWalletInput!) {
        reviewStoreUsdtWallet(input: $input) {
            channelId
            reviewStatus
            configured
        }
    }
`;
