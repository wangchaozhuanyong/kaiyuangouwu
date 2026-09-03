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
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
}

export interface PosterAssetChoice {
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
