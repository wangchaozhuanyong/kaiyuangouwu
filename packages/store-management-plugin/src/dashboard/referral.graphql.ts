import { gql } from 'graphql-tag';

const referralProgramFields = gql`
    fragment ReferralProgramFields on ReferralProgram {
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
                width
                height
                mimeType
            }
            shareBackgroundAsset {
                id
                name
                preview
                source
                width
                height
                mimeType
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
`;

export const referralProgramQuery = gql`
    ${referralProgramFields}
    query ReferralProgramAdmin {
        referralProgram {
            ...ReferralProgramFields
        }
    }
`;

export const updateReferralProgramMutation = gql`
    ${referralProgramFields}
    mutation UpdateReferralProgramAdmin($input: UpdateReferralProgramInput!) {
        updateReferralProgram(input: $input) {
            ...ReferralProgramFields
        }
    }
`;

const referralPosterTemplateFields = gql`
    fragment ReferralPosterTemplateFields on ReferralPosterTemplate {
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
            width
            height
            mimeType
        }
        shareBackgroundAsset {
            id
            name
            preview
            source
            width
            height
            mimeType
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
`;

export const createReferralPosterTemplateMutation = gql`
    ${referralPosterTemplateFields}
    mutation CreateReferralPosterTemplateAdmin($input: CreateReferralPosterTemplateInput!) {
        createReferralPosterTemplate(input: $input) {
            ...ReferralPosterTemplateFields
        }
    }
`;

export const updateReferralPosterTemplateMutation = gql`
    ${referralPosterTemplateFields}
    mutation UpdateReferralPosterTemplateAdmin($input: UpdateReferralPosterTemplateInput!) {
        updateReferralPosterTemplate(input: $input) {
            ...ReferralPosterTemplateFields
        }
    }
`;

export const deleteReferralPosterTemplateMutation = gql`
    mutation DeleteReferralPosterTemplateAdmin($id: ID!) {
        deleteReferralPosterTemplate(id: $id) {
            result
            message
        }
    }
`;

export const referralReportsQuery = gql`
    query ReferralReportsAdmin(
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

export const referralTodayMetricsQuery = gql`
    query ReferralTodayMetricsAdmin {
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

export const referralCustomerLookupQuery = gql`
    query ReferralCustomerLookup($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                firstName
                lastName
                emailAddress
            }
        }
    }
`;

export const referralCustomerWalletsQuery = gql`
    query ReferralCustomerWalletsAdmin($customerId: ID!) {
        referralCustomerWallets(customerId: $customerId) {
            id
            currencyCode
            availableBalance
            pendingBalance
            reservedBalance
        }
    }
`;

export const createReferralWithdrawalMutation = gql`
    mutation CreateReferralWithdrawalAdmin($input: CreateReferralWithdrawalInput!) {
        createReferralWithdrawal(input: $input) {
            id
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
            createdAt
            updatedAt
            approvedAt
            paidAt
            rejectedAt
            cancelledAt
        }
    }
`;

export const processReferralWithdrawalMutation = gql`
    mutation ProcessReferralWithdrawalAdmin($input: ProcessReferralWithdrawalInput!) {
        processReferralWithdrawal(input: $input) {
            id
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
            createdAt
            updatedAt
            approvedAt
            paidAt
            rejectedAt
            cancelledAt
        }
    }
`;

export const adjustReferralBalanceMutation = gql`
    mutation AdjustReferralBalanceAdmin(
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
    posterTemplateConfigs: ReferralPosterTemplateRecord[];
}

export interface ReferralPosterAssetRecord {
    id: string;
    name: string;
    preview: string;
    source: string;
    width: number;
    height: number;
    mimeType: string;
}

export interface ReferralPosterTemplateRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAsset: ReferralPosterAssetRecord | null;
    shareBackgroundAsset: ReferralPosterAssetRecord | null;
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

export interface ReferralRelationshipRecord {
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
}

export interface ReferralInviterSummaryRecord {
    customerId: string;
    customerName: string;
    customerEmail: string;
    inviteCode: string;
    invitedCount: number;
    purchasedInviteeCount: number;
}

export interface ReferralRewardRecord {
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
}

export interface ReferralLedgerRecord {
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
}

export interface ReferralWithdrawalRecord {
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
}

export interface ReferralReportsResult {
    referralRelationships: { items: ReferralRelationshipRecord[]; totalItems: number };
    referralInviterSummaries: { items: ReferralInviterSummaryRecord[]; totalItems: number };
    referralRewards: { items: ReferralRewardRecord[]; totalItems: number };
    referralLedger: { items: ReferralLedgerRecord[]; totalItems: number };
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
    referralWithdrawals: { items: ReferralWithdrawalRecord[]; totalItems: number };
}

export interface ReferralTodayMetricsRecord {
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
}

export interface ReferralTodayMetricsResult {
    referralTodayMetrics: ReferralTodayMetricsRecord;
}

export interface ReferralCustomerRecord {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
}

export interface ReferralCustomerWalletRecord {
    id: string;
    currencyCode: string;
    availableBalance: number;
    pendingBalance: number;
    reservedBalance: number;
}
