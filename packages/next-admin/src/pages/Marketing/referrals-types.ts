import { ReferralReportsResult } from '../../graphql/marketing.graphql';

export type ReferralTab = 'SETTINGS' | 'PROMOTERS' | 'REWARDS' | 'LEDGER' | 'WITHDRAWALS' | 'POSTERS';

export type ReportKey = 'summaries' | 'relationships' | 'rewards' | 'ledger' | 'withdrawals';

export type WithdrawalRecord = ReferralReportsResult['referralWithdrawals']['items'][number];

export type WithdrawalAction = {
    item: WithdrawalRecord;
    status: 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
};

export interface ProgramDraft {
    expectedUpdatedAt: string;
    enabled: boolean;
    rewardRate: number;
    releaseDelayDays: number;
    minimumOrderAmount: string;
    maxRewardPerOrder: string;
    allowBalanceSpend: boolean;
    attributionWindowDays: number;
    defaultPosterTemplate: string;
    posterTemplates: string[];
}

export interface PosterDraft {
    id?: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAssetId: string;
    shareBackgroundAssetId: string;
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

export interface PosterAssetChoice {
    source?: string;
    width?: number;
    height?: number;
    id: string;
    name: string;
    preview: string;
}

export interface PosterAssetLookupResult {
    assets: {
        totalItems: number;
        items: PosterAssetChoice[];
    };
}
