import type {
    MyReferralOverview,
    ReferralBalancePaymentResult,
    ReferralProgram,
    RegisterCustomerInput,
} from '../types';
import type { ErrorResult } from './helpers';

import { BaseDomainApi } from './base-domain-api';
import { orderFields, referralWalletFields } from './fragments';

export class ReferralsApi extends BaseDomainApi {
    async referralProgram(signal?: AbortSignal): Promise<ReferralProgram> {
        const result = await this.request<{ referralProgram: ReferralProgram }>(
            `
                query StorefrontReferralProgram {
                    referralProgram {
                        channelId
                        enabled
                        rewardRate
                        releaseDelayDays
                        currencyCode
                        minimumOrderAmount
                        maxRewardPerOrder
                        allowBalanceSpend
                        attributionWindowDays
                        defaultPosterTemplate
                        posterTemplates
                        posterTemplateConfigs {
                            id
                            updatedAt
                            design
                            name
                            enabled
                            position
                            layoutVariant
                            posterBackgroundAsset {
                                id
                                preview
                                source
                                width
                                height
                            }
                            shareBackgroundAsset {
                                id
                                preview
                                source
                                width
                                height
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
                            id
                            updatedAt
                            design
                            name
                            enabled
                            position
                            layoutVariant
                            posterBackgroundAsset {
                                id
                                preview
                                source
                                width
                                height
                            }
                            shareBackgroundAsset {
                                id
                                preview
                                source
                                width
                                height
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
                }
            `,
            undefined,
            signal,
        );
        return result.referralProgram;
    }

    async validateReferralInviteCode(code: string, signal?: AbortSignal): Promise<boolean> {
        const result = await this.request<{ validateReferralInviteCode: boolean }>(
            `
                query ValidateReferralInviteCode($code: String!) {
                    validateReferralInviteCode(code: $code)
                }
            `,
            { code },
            signal,
        );
        return result.validateReferralInviteCode;
    }

    async myReferralOverview(signal?: AbortSignal): Promise<MyReferralOverview> {
        const result = await this.request<{ myReferralOverview: MyReferralOverview }>(
            `
                query MyStorefrontReferralOverview {
                    myReferralOverview {
                        enabled
                        rewardRate
                        releaseDelayDays
                        inviteCode
                        wallets { ${referralWalletFields} }
                        invitedCount
                        purchasedInviteeCount
                        rewardSummaries { currencyCode grossReward clawedBackReward }
                        invitees { id displayName boundAt firstPaidOrderAt }
                        ledger {
                            id
                            createdAt
                            eventType
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
                }
            `,
            undefined,
            signal,
        );
        return result.myReferralOverview;
    }

    async registerCustomerAccount(
        input: RegisterCustomerInput,
        inviteCode?: string,
        source?: 'LINK' | 'POSTER' | 'CODE',
    ): Promise<void> {
        const result = await this.request<{ registerCustomerWithReferral: ErrorResult }>(
            `
                mutation RegisterStorefrontCustomer(
                    $input: RegisterCustomerInput!
                    $inviteCode: String
                    $source: String
                ) {
                    registerCustomerWithReferral(input: $input, inviteCode: $inviteCode, source: $source) {
                        __typename
                        ... on Success { success }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input, inviteCode: inviteCode || null, source: source ?? null },
        );
        this.assertNoError(result.registerCustomerWithReferral);
    }

    async useReferralBalance(amount: number): Promise<ReferralBalancePaymentResult> {
        const result = await this.request<{ useMyReferralBalance: ReferralBalancePaymentResult }>(
            `
                mutation UseStorefrontReferralBalance($amount: Money!) {
                    useMyReferralBalance(amount: $amount) {
                        amount
                        wallet { ${referralWalletFields} }
                        order { ${orderFields} }
                    }
                }
            `,
            { amount },
        );
        return result.useMyReferralBalance;
    }

    async recordStorefrontVisit(): Promise<boolean> {
        const result = await this.request<{ recordStorefrontVisit: { recorded: boolean } }>(
            `
                mutation RecordStorefrontVisit {
                    recordStorefrontVisit { recorded }
                }
            `,
        );
        return result.recordStorefrontVisit.recorded;
    }
}
