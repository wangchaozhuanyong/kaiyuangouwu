import { gql } from '@apollo/client';

export const MARKETING_OVERVIEW_QUERY = gql`
    query AdminMarketingOverview {
        activeChannel {
            id
            code
            defaultCurrencyCode
        }
        storeCouponCampaigns {
            id
            createdAt
            updatedAt
            name
            couponCode
            kind
            enabled
            startsAt
            endsAt
            minimumSpend
            discountAmount
            discountRate
            collectionIds
            productVariantIds
            usageLimit
            perCustomerUsageLimit
            claimStartsAt
            claimEndsAt
            validityDays
            issueLimit
            perCustomerClaimLimit
            stackPolicy
            returnOnCancellation
            returnOnFullRefund
            archivedAt
            remainingIssueCount
            claimedCount
            availableCount
            lockedCount
            usedCount
            returnedCount
            expiredCount
            revokedCount
            redeemedOrderCount
            refundedOrderCount
            discountAmountTotal
            assistedRevenueTotal
        }
        storeFlashSales {
            id
            createdAt
            updatedAt
            name
            enabled
            startsAt
            endsAt
            items {
                productId
                productVariantId
                productName
                variantName
                originalPrice
                salePrice
                currencyCode
                imageUrl
            }
        }
    }
`;

export const MARKETING_CAMPAIGN_SCOPE_QUERY = gql`
    query AdminMarketingCampaignScope(
        $collectionIds: [String!]!
        $variantIds: [String!]!
        $collectionTake: Int!
        $variantTake: Int!
    ) {
        collections(
            options: {
                take: $collectionTake
                filter: { id: { in: $collectionIds } }
                sort: { name: ASC, id: ASC }
            }
        ) {
            items {
                id
                name
            }
        }
        productVariants(
            options: { take: $variantTake, filter: { id: { in: $variantIds } }, sort: { name: ASC, id: ASC } }
        ) {
            items {
                id
                name
                sku
                product {
                    id
                    name
                }
            }
        }
    }
`;

export const MARKETING_CATALOG_LOOKUP_QUERY = gql`
    query AdminMarketingCatalogLookup(
        $collectionOptions: CollectionListOptions
        $productOptions: ProductListOptions
    ) {
        collections(options: $collectionOptions) {
            totalItems
            items {
                id
                name
            }
        }
        products(options: $productOptions) {
            totalItems
            items {
                id
                name
                variants {
                    id
                    name
                    priceWithTax
                    currencyCode
                }
            }
        }
    }
`;

export const COUPON_LEDGER_QUERY = gql`
    query AdminCouponLedger($options: StoreCouponLedgerEntryListOptions) {
        storeCouponLedger(options: $options) {
            totalItems
            items {
                id
                createdAt
                eventType
                actorType
                campaignId
                campaignName
                customerCouponId
                customerId
                customerName
                customerEmail
                orderId
                orderCode
                refundId
                discountAmount
                note
            }
        }
    }
`;

export const COUPON_DAILY_REPORT_QUERY = gql`
    query AdminCouponDailyReport($from: DateTime!, $to: DateTime!, $campaignId: ID) {
        storeCouponDailyReport(from: $from, to: $to, campaignId: $campaignId) {
            date
            claimedCount
            redeemedCount
            refundedCount
            returnedCount
            expiredCount
            revokedCount
            discountAmountTotal
            assistedRevenueTotal
        }
    }
`;

export const CREATE_COUPON_CAMPAIGN_MUTATION = gql`
    mutation AdminCreateCouponCampaign($input: CreateStoreCouponCampaignInput!) {
        createStoreCouponCampaign(input: $input) {
            id
            name
        }
    }
`;

export const CREATE_FLASH_SALE_MUTATION = gql`
    mutation AdminCreateFlashSale($input: CreateStoreFlashSaleInput!) {
        createStoreFlashSale(input: $input) {
            id
            name
        }
    }
`;

export const SET_PROMOTION_ENABLED_MUTATION = gql`
    mutation AdminSetPromotionEnabled($id: ID!, $enabled: Boolean!, $password: String!) {
        setStorePromotionEnabled(id: $id, enabled: $enabled, password: $password) {
            id
            enabled
        }
    }
`;

export const UPDATE_PROMOTION_NAME_MUTATION = gql`
    mutation AdminUpdatePromotionName($id: ID!, $name: String!) {
        updateStorePromotionName(id: $id, name: $name) {
            id
            name
        }
    }
`;

export const STOP_COUPON_ISSUANCE_MUTATION = gql`
    mutation AdminStopCouponIssuance($id: ID!, $password: String!) {
        stopStoreCouponIssuance(id: $id, password: $password) {
            id
            claimEndsAt
        }
    }
`;

export const ARCHIVE_COUPON_CAMPAIGN_MUTATION = gql`
    mutation AdminArchiveCouponCampaign($id: ID!, $password: String!) {
        archiveStoreCouponCampaign(id: $id, password: $password) {
            id
            archivedAt
            claimEndsAt
        }
    }
`;

export const REVOKE_COUPON_CAMPAIGN_MUTATION = gql`
    mutation AdminRevokeCouponCampaign($id: ID!, $password: String!, $reason: String) {
        revokeStoreCouponCampaignOutstanding(id: $id, password: $password, reason: $reason) {
            campaignId
            affectedCount
        }
    }
`;

export const DELETE_STORE_PROMOTION_MUTATION = gql`
    mutation AdminDeleteStorePromotion($id: ID!, $password: String!) {
        deleteStorePromotion(id: $id, password: $password) {
            result
            message
        }
    }
`;

export const GRANT_STORE_COUPON_MUTATION = gql`
    mutation AdminGrantStoreCoupon($campaignId: ID!, $customerId: ID!) {
        grantStoreCoupon(campaignId: $campaignId, customerId: $customerId) {
            id
            status
            campaignName
            customerCouponId: id
        }
    }
`;

export const MARKETING_CUSTOMER_LOOKUP_QUERY = gql`
    query AdminMarketingCustomerLookup($options: CustomerListOptions) {
        customers(options: $options) {
            totalItems
            items {
                id
                firstName
                lastName
                emailAddress
                phoneNumber
            }
        }
    }
`;

export const REFERRAL_PROGRAM_QUERY = gql`
    query AdminReferralProgram {
        activeChannel {
            id
            code
            defaultCurrencyCode
        }
        referralProgram {
            channelId
            updatedAt
            enabled
            rewardRate
            releaseDelayDays
            minimumOrderAmount
            maxRewardPerOrder
            allowBalanceSpend
            attributionWindowDays
            defaultPosterTemplate
            posterTemplates
            posterTemplateConfigs {
                design
                id
                createdAt
                updatedAt
                name
                enabled
                position
                layoutVariant
                posterBackgroundAsset {
                    id
                    name
                    preview
                    source
                }
                shareBackgroundAsset {
                    id
                    name
                    preview
                    source
                }
                titleZh
                titleEn
                headlineZh
                headlineEn
                rewardTextZh
                rewardTextEn
                siteIntroZh
                siteIntroEn
                serviceTextZh
                serviceTextEn
                featureOneTitleZh
                featureOneTitleEn
                featureOneTextZh
                featureOneTextEn
                featureTwoTitleZh
                featureTwoTitleEn
                featureTwoTextZh
                featureTwoTextEn
                featureThreeTitleZh
                featureThreeTitleEn
                featureThreeTextZh
                featureThreeTextEn
                qrEyebrowZh
                qrEyebrowEn
                qrTitleZh
                qrTitleEn
                qrDescriptionZh
                qrDescriptionEn
                sceneOneZh
                sceneOneEn
                sceneTwoZh
                sceneTwoEn
                sceneThreeZh
                sceneThreeEn
                sceneFourZh
                sceneFourEn
                ctaTextZh
                ctaTextEn
                footerTitleZh
                footerTitleEn
                footerTextZh
                footerTextEn
                foregroundColor
                accentColor
                overlayOpacity
            }
            systemPosterTemplateConfigs {
                design
                id
                createdAt
                updatedAt
                name
                enabled
                position
                layoutVariant
                posterBackgroundAsset {
                    id
                    name
                    preview
                    source
                }
                shareBackgroundAsset {
                    id
                    name
                    preview
                    source
                }
                titleZh
                titleEn
                headlineZh
                headlineEn
                rewardTextZh
                rewardTextEn
                siteIntroZh
                siteIntroEn
                serviceTextZh
                serviceTextEn
                featureOneTitleZh
                featureOneTitleEn
                featureOneTextZh
                featureOneTextEn
                featureTwoTitleZh
                featureTwoTitleEn
                featureTwoTextZh
                featureTwoTextEn
                featureThreeTitleZh
                featureThreeTitleEn
                featureThreeTextZh
                featureThreeTextEn
                qrEyebrowZh
                qrEyebrowEn
                qrTitleZh
                qrTitleEn
                qrDescriptionZh
                qrDescriptionEn
                sceneOneZh
                sceneOneEn
                sceneTwoZh
                sceneTwoEn
                sceneThreeZh
                sceneThreeEn
                sceneFourZh
                sceneFourEn
                ctaTextZh
                ctaTextEn
                footerTitleZh
                footerTitleEn
                footerTextZh
                footerTextEn
                foregroundColor
                accentColor
                overlayOpacity
            }
        }
        referralTodayMetrics {
            businessDate
            visitorCount
            newCustomerCount
            consumerCount
            firstTimeConsumerCount
            returningConsumerCount
            orderCount
            todayInvitedCount
            todayInvitedPurchaserCount
            salesByCurrency {
                currencyCode
                sales
            }
        }
    }
`;

export const REFERRAL_REPORTS_QUERY = gql`
    query AdminReferralReports(
        $take: Int!
        $summarySkip: Int!
        $relationshipSkip: Int!
        $rewardSkip: Int!
        $ledgerSkip: Int!
        $withdrawalSkip: Int!
    ) {
        referralRelationships(skip: $relationshipSkip, take: $take) {
            totalItems
            items {
                id
                inviterCustomerId
                inviterName
                inviterEmail
                inviteeCustomerId
                inviteeName
                inviteeEmail
                inviteCodeSnapshot
                source
                boundAt
                firstPaidOrderAt
            }
        }
        referralInviterSummaries(skip: $summarySkip, take: $take) {
            totalItems
            items {
                customerId
                customerName
                customerEmail
                inviteCode
                invitedCount
                purchasedInviteeCount
            }
        }
        referralRewards(skip: $rewardSkip, take: $take) {
            totalItems
            items {
                id
                orderId
                orderCode
                inviterName
                inviterEmail
                inviteeName
                inviteeEmail
                currencyCode
                rewardRate
                eligibleAmount
                rewardAmount
                releasedAmount
                clawedBackAmount
                settledRefundTotal
                settledEligibleRefundTotal
                orderTotalWithTax
                status
                earnedAt
                availableAt
                releasedAt
            }
        }
        referralLedger(skip: $ledgerSkip, take: $take) {
            totalItems
            items {
                id
                createdAt
                eventType
                customerName
                customerEmail
                currencyCode
                availableDelta
                pendingDelta
                reservedDelta
                availableAfter
                pendingAfter
                reservedAfter
                orderId
                refundId
                withdrawalId
                actorType
                note
            }
        }
        referralBalanceAudit {
            auditedWallets
            items {
                walletId
                customerId
                customerName
                customerEmail
                currencyCode
                actualAvailableBalance
                actualPendingBalance
                actualReservedBalance
                ledgerAvailableBalance
                ledgerPendingBalance
                ledgerReservedBalance
                availableDifference
                pendingDifference
                reservedDifference
            }
        }
        referralWithdrawals(skip: $withdrawalSkip, take: $take) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                code
                customerId
                customerName
                customerEmail
                currencyCode
                amount
                status
                payoutMethod
                payoutAccountMasked
                externalReference
                note
                approvedAt
                paidAt
                rejectedAt
                cancelledAt
            }
        }
    }
`;

export const UPDATE_REFERRAL_PROGRAM_MUTATION = gql`
    mutation AdminUpdateReferralProgram($input: UpdateReferralProgramInput!) {
        updateReferralProgram(input: $input) {
            channelId
            updatedAt
            enabled
            rewardRate
            releaseDelayDays
            minimumOrderAmount
            maxRewardPerOrder
            allowBalanceSpend
            attributionWindowDays
            defaultPosterTemplate
            posterTemplates
        }
    }
`;

export const PROCESS_REFERRAL_WITHDRAWAL_MUTATION = gql`
    mutation AdminProcessReferralWithdrawal($input: ProcessReferralWithdrawalInput!) {
        processReferralWithdrawal(input: $input) {
            id
            status
            externalReference
            note
            updatedAt
        }
    }
`;

export const REFERRAL_CUSTOMER_WALLETS_QUERY = gql`
    query AdminReferralCustomerWallets($customerId: ID!) {
        referralCustomerWallets(customerId: $customerId) {
            id
            currencyCode
            availableBalance
            pendingBalance
            reservedBalance
        }
    }
`;

export const CREATE_REFERRAL_WITHDRAWAL_MUTATION = gql`
    mutation AdminCreateReferralWithdrawal($input: CreateReferralWithdrawalInput!) {
        createReferralWithdrawal(input: $input) {
            id
            code
            status
            amount
            currencyCode
        }
    }
`;

export const ADJUST_REFERRAL_BALANCE_MUTATION = gql`
    mutation AdminAdjustReferralBalance(
        $customerId: ID!
        $currencyCode: CurrencyCode!
        $amount: Money!
        $reason: String!
    ) {
        adjustReferralBalance(
            customerId: $customerId
            currencyCode: $currencyCode
            amount: $amount
            reason: $reason
        ) {
            id
            currencyCode
            availableBalance
            pendingBalance
            reservedBalance
        }
    }
`;

export const CREATE_REFERRAL_POSTER_MUTATION = gql`
    mutation AdminCreateReferralPoster($input: CreateReferralPosterTemplateInput!) {
        createReferralPosterTemplate(input: $input) {
            id
            name
        }
    }
`;

export const UPDATE_REFERRAL_POSTER_MUTATION = gql`
    mutation AdminUpdateReferralPoster($input: UpdateReferralPosterTemplateInput!) {
        updateReferralPosterTemplate(input: $input) {
            id
            name
        }
    }
`;

export const SET_REFERRAL_POSTER_ENABLED_MUTATION = gql`
    mutation SetReferralPosterEnabled($id: ID!, $enabled: Boolean!, $expectedUpdatedAt: DateTime!) {
        setReferralPosterTemplateEnabled(id: $id, enabled: $enabled, expectedUpdatedAt: $expectedUpdatedAt) {
            updatedAt
            defaultPosterTemplate
        }
    }
`;

export const DELETE_REFERRAL_POSTER_MUTATION = gql`
    mutation AdminDeleteReferralPoster($id: ID!) {
        deleteReferralPosterTemplate(id: $id) {
            result
            message
        }
    }
`;

export type StoreCouponKind =
    'ORDER_FIXED' | 'ORDER_PERCENTAGE' | 'COLLECTION_PERCENTAGE' | 'PRODUCT_PERCENTAGE';

export interface StoreCouponRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    couponCode: string;
    kind: StoreCouponKind;
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    minimumSpend: number;
    discountAmount: number | null;
    discountRate: number | null;
    collectionIds: string[];
    productVariantIds: string[];
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
    claimStartsAt: string | null;
    claimEndsAt: string | null;
    validityDays: number | null;
    issueLimit: number | null;
    perCustomerClaimLimit: number;
    stackPolicy: 'EXCLUSIVE' | 'STACKABLE';
    returnOnCancellation: boolean;
    returnOnFullRefund: boolean;
    archivedAt: string | null;
    remainingIssueCount: number | null;
    claimedCount: number;
    availableCount: number;
    lockedCount: number;
    usedCount: number;
    returnedCount: number;
    expiredCount: number;
    revokedCount: number;
    redeemedOrderCount: number;
    refundedOrderCount: number;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
}

export interface StoreFlashSaleRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    items: Array<{
        productId: string;
        productVariantId: string;
        productName: string;
        variantName: string;
        originalPrice: number;
        salePrice: number;
        currencyCode: string;
        imageUrl: string | null;
    }>;
}

export interface MarketingCampaignScopeResult {
    collections: { items: Array<{ id: string; name: string }> };
    productVariants: {
        items: Array<{ id: string; name: string; sku: string; product: { id: string; name: string } }>;
    };
}

export interface PromotionProductRecord {
    id: string;
    name: string;
    variants: Array<{ id: string; name: string; priceWithTax: number; currencyCode: string }>;
}

export interface MarketingOverviewResult {
    activeChannel: { id: string; code: string; defaultCurrencyCode: string };
    storeCouponCampaigns: StoreCouponRecord[];
    storeFlashSales: StoreFlashSaleRecord[];
}

export interface CouponLedgerRecord {
    id: string;
    createdAt: string;
    eventType: string;
    actorType: string;
    campaignId: string;
    campaignName: string;
    customerCouponId: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    orderId: string | null;
    orderCode: string | null;
    refundId: string | null;
    discountAmount: number | null;
    note: string | null;
}

export interface CouponDailyMetricRecord {
    date: string;
    claimedCount: number;
    redeemedCount: number;
    refundedCount: number;
    returnedCount: number;
    expiredCount: number;
    revokedCount: number;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
}

export interface ReferralPosterRecord {
    design?: import('../../../storefront/src/referral-poster-layout').PosterDesign | null;
    id: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAsset: { id: string; name: string; preview: string; source: string } | null;
    shareBackgroundAsset: { id: string; name: string; preview: string; source: string } | null;
    titleZh: string;
    titleEn: string;
    headlineZh: string;
    headlineEn: string;
    rewardTextZh: string;
    rewardTextEn: string;
    siteIntroZh: string;
    siteIntroEn: string;
    serviceTextZh: string;
    serviceTextEn: string;
    featureOneTitleZh: string;
    featureOneTitleEn: string;
    featureOneTextZh: string;
    featureOneTextEn: string;
    featureTwoTitleZh: string;
    featureTwoTitleEn: string;
    featureTwoTextZh: string;
    featureTwoTextEn: string;
    featureThreeTitleZh: string;
    featureThreeTitleEn: string;
    featureThreeTextZh: string;
    featureThreeTextEn: string;
    qrEyebrowZh: string;
    qrEyebrowEn: string;
    qrTitleZh: string;
    qrTitleEn: string;
    qrDescriptionZh: string;
    qrDescriptionEn: string;
    sceneOneZh: string;
    sceneOneEn: string;
    sceneTwoZh: string;
    sceneTwoEn: string;
    sceneThreeZh: string;
    sceneThreeEn: string;
    sceneFourZh: string;
    sceneFourEn: string;
    ctaTextZh: string;
    ctaTextEn: string;
    footerTitleZh: string;
    footerTitleEn: string;
    footerTextZh: string;
    footerTextEn: string;
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
}

export interface ReferralProgramRecord {
    channelId: string;
    updatedAt: string;
    enabled: boolean;
    rewardRate: number;
    releaseDelayDays: number;
    minimumOrderAmount: number;
    maxRewardPerOrder: number | null;
    allowBalanceSpend: boolean;
    attributionWindowDays: number;
    defaultPosterTemplate: string;
    posterTemplates: string[];
    posterTemplateConfigs: ReferralPosterRecord[];
    systemPosterTemplateConfigs: ReferralPosterRecord[];
}

export interface ReferralProgramResult {
    activeChannel: { id: string; code: string; defaultCurrencyCode: string };
    referralProgram: ReferralProgramRecord;
    referralTodayMetrics: {
        businessDate: string;
        visitorCount: number;
        newCustomerCount: number;
        consumerCount: number;
        firstTimeConsumerCount: number;
        returningConsumerCount: number;
        orderCount: number;
        todayInvitedCount: number;
        todayInvitedPurchaserCount: number;
        salesByCurrency: Array<{ currencyCode: string; sales: number }>;
    };
}

export interface ReferralReportsResult {
    referralRelationships: {
        totalItems: number;
        items: Array<{
            id: string;
            inviterCustomerId: string;
            inviterName: string;
            inviterEmail: string;
            inviteeCustomerId: string;
            inviteeName: string;
            inviteeEmail: string;
            inviteCodeSnapshot: string;
            source: string;
            boundAt: string;
            firstPaidOrderAt: string | null;
        }>;
    };
    referralInviterSummaries: {
        totalItems: number;
        items: Array<{
            customerId: string;
            customerName: string;
            customerEmail: string;
            inviteCode: string;
            invitedCount: number;
            purchasedInviteeCount: number;
        }>;
    };
    referralRewards: {
        totalItems: number;
        items: Array<{
            id: string;
            orderId: string;
            orderCode: string;
            inviterName: string;
            inviterEmail: string;
            inviteeName: string;
            inviteeEmail: string;
            currencyCode: string;
            rewardRate: number;
            eligibleAmount: number;
            rewardAmount: number;
            releasedAmount: number;
            clawedBackAmount: number;
            settledRefundTotal: number;
            settledEligibleRefundTotal: number;
            orderTotalWithTax: number;
            status: string;
            earnedAt: string;
            availableAt: string;
            releasedAt: string | null;
        }>;
    };
    referralLedger: {
        totalItems: number;
        items: Array<{
            id: string;
            createdAt: string;
            eventType: string;
            customerName: string;
            customerEmail: string;
            currencyCode: string;
            availableDelta: number;
            pendingDelta: number;
            reservedDelta: number;
            availableAfter: number;
            pendingAfter: number;
            reservedAfter: number;
            orderId: string | null;
            refundId: string | null;
            withdrawalId: string | null;
            actorType: string;
            note: string | null;
        }>;
    };
    referralBalanceAudit: {
        auditedWallets: number;
        items: Array<{
            walletId: string;
            customerId: string;
            customerName: string;
            customerEmail: string;
            currencyCode: string;
            actualAvailableBalance: number;
            actualPendingBalance: number;
            actualReservedBalance: number;
            ledgerAvailableBalance: number;
            ledgerPendingBalance: number;
            ledgerReservedBalance: number;
            availableDifference: number;
            pendingDifference: number;
            reservedDifference: number;
        }>;
    };
    referralWithdrawals: {
        totalItems: number;
        items: Array<{
            id: string;
            createdAt: string;
            updatedAt: string;
            code: string;
            customerId: string;
            customerName: string;
            customerEmail: string;
            currencyCode: string;
            amount: number;
            status: string;
            payoutMethod: string;
            payoutAccountMasked: string;
            externalReference: string | null;
            note: string | null;
            approvedAt: string | null;
            paidAt: string | null;
            rejectedAt: string | null;
            cancelledAt: string | null;
        }>;
    };
}
