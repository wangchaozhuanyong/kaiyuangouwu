import { ID, UserInputError } from '@vendure/core';

import { referralPosterCopy } from './referral-poster-presets';

export interface SaveReferralPosterTemplateInput {
    expectedUpdatedAt?: Date;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAssetId?: ID | null;
    shareBackgroundAssetId?: ID | null;
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
    featureOneTitleZh?: string;
    featureOneTitleEn?: string;
    featureOneTextZh?: string;
    featureOneTextEn?: string;
    featureTwoTitleZh?: string;
    featureTwoTitleEn?: string;
    featureTwoTextZh?: string;
    featureTwoTextEn?: string;
    featureThreeTitleZh?: string;
    featureThreeTitleEn?: string;
    featureThreeTextZh?: string;
    featureThreeTextEn?: string;
    qrEyebrowZh?: string;
    qrEyebrowEn?: string;
    qrTitleZh?: string;
    qrTitleEn?: string;
    qrDescriptionZh?: string;
    qrDescriptionEn?: string;
    sceneOneZh?: string;
    sceneOneEn?: string;
    sceneTwoZh?: string;
    sceneTwoEn?: string;
    sceneThreeZh?: string;
    sceneThreeEn?: string;
    sceneFourZh?: string;
    sceneFourEn?: string;
    ctaTextZh?: string;
    ctaTextEn?: string;
    footerTitleZh?: string;
    footerTitleEn?: string;
    footerTextZh?: string;
    footerTextEn?: string;
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
}

export interface UpdateReferralPosterTemplateInput extends Omit<
    SaveReferralPosterTemplateInput,
    'enabled' | 'expectedUpdatedAt'
> {
    id: ID;
    expectedUpdatedAt: Date;
}

export function normalizeReferralPosterInput(input: SaveReferralPosterTemplateInput) {
    if (!Number.isInteger(input.position) || input.position < 0 || input.position > 100_000) {
        throw new UserInputError('模板排序必须是0至100000之间的整数');
    }
    if (input.layoutVariant !== 'STANDARD_CENTER') {
        throw new UserInputError('海报版式无效');
    }
    if (!Number.isInteger(input.overlayOpacity) || input.overlayOpacity < 0 || input.overlayOpacity > 80) {
        throw new UserInputError('遮罩透明度必须在0至80之间');
    }
    return {
        name: requiredText(input.name, '模板名称', 128),
        enabled: input.enabled,
        position: input.position,
        layoutVariant: input.layoutVariant,
        titleZh: requiredText(input.titleZh, '中文小标题', 80),
        titleEn: requiredText(input.titleEn, '英文小标题', 80),
        headlineZh: requiredText(input.headlineZh, '中文主标题', 180),
        headlineEn: requiredText(input.headlineEn, '英文主标题', 180),
        rewardTextZh: requiredText(input.rewardTextZh, '中文奖励文案', 220),
        rewardTextEn: requiredText(input.rewardTextEn, '英文奖励文案', 220),
        siteIntroZh: clippedText(input.siteIntroZh, 260),
        siteIntroEn: clippedText(input.siteIntroEn, 260),
        serviceTextZh: clippedText(input.serviceTextZh, 260),
        serviceTextEn: clippedText(input.serviceTextEn, 260),
        featureOneTitleZh: clippedText(input.featureOneTitleZh ?? referralPosterCopy.featureOneTitleZh, 100),
        featureOneTitleEn: clippedText(input.featureOneTitleEn ?? referralPosterCopy.featureOneTitleEn, 100),
        featureOneTextZh: clippedText(input.featureOneTextZh ?? referralPosterCopy.featureOneTextZh, 160),
        featureOneTextEn: clippedText(input.featureOneTextEn ?? referralPosterCopy.featureOneTextEn, 160),
        featureTwoTitleZh: clippedText(input.featureTwoTitleZh ?? referralPosterCopy.featureTwoTitleZh, 100),
        featureTwoTitleEn: clippedText(input.featureTwoTitleEn ?? referralPosterCopy.featureTwoTitleEn, 100),
        featureTwoTextZh: clippedText(input.featureTwoTextZh ?? referralPosterCopy.featureTwoTextZh, 160),
        featureTwoTextEn: clippedText(input.featureTwoTextEn ?? referralPosterCopy.featureTwoTextEn, 160),
        featureThreeTitleZh: clippedText(
            input.featureThreeTitleZh ?? referralPosterCopy.featureThreeTitleZh,
            100,
        ),
        featureThreeTitleEn: clippedText(
            input.featureThreeTitleEn ?? referralPosterCopy.featureThreeTitleEn,
            100,
        ),
        featureThreeTextZh: clippedText(
            input.featureThreeTextZh ?? referralPosterCopy.featureThreeTextZh,
            160,
        ),
        featureThreeTextEn: clippedText(
            input.featureThreeTextEn ?? referralPosterCopy.featureThreeTextEn,
            160,
        ),
        qrEyebrowZh: clippedText(input.qrEyebrowZh ?? referralPosterCopy.qrEyebrowZh, 100),
        qrEyebrowEn: clippedText(input.qrEyebrowEn ?? referralPosterCopy.qrEyebrowEn, 100),
        qrTitleZh: clippedText(input.qrTitleZh ?? referralPosterCopy.qrTitleZh, 140),
        qrTitleEn: clippedText(input.qrTitleEn ?? referralPosterCopy.qrTitleEn, 140),
        qrDescriptionZh: clippedText(input.qrDescriptionZh ?? referralPosterCopy.qrDescriptionZh, 140),
        qrDescriptionEn: clippedText(input.qrDescriptionEn ?? referralPosterCopy.qrDescriptionEn, 140),
        sceneOneZh: clippedText(input.sceneOneZh ?? referralPosterCopy.sceneOneZh, 48),
        sceneOneEn: clippedText(input.sceneOneEn ?? referralPosterCopy.sceneOneEn, 48),
        sceneTwoZh: clippedText(input.sceneTwoZh ?? referralPosterCopy.sceneTwoZh, 48),
        sceneTwoEn: clippedText(input.sceneTwoEn ?? referralPosterCopy.sceneTwoEn, 48),
        sceneThreeZh: clippedText(input.sceneThreeZh ?? referralPosterCopy.sceneThreeZh, 48),
        sceneThreeEn: clippedText(input.sceneThreeEn ?? referralPosterCopy.sceneThreeEn, 48),
        sceneFourZh: clippedText(input.sceneFourZh ?? referralPosterCopy.sceneFourZh, 48),
        sceneFourEn: clippedText(input.sceneFourEn ?? referralPosterCopy.sceneFourEn, 48),
        ctaTextZh: clippedText(input.ctaTextZh ?? referralPosterCopy.ctaTextZh, 140),
        ctaTextEn: clippedText(input.ctaTextEn ?? referralPosterCopy.ctaTextEn, 140),
        footerTitleZh: clippedText(input.footerTitleZh ?? referralPosterCopy.footerTitleZh, 160),
        footerTitleEn: clippedText(input.footerTitleEn ?? referralPosterCopy.footerTitleEn, 160),
        footerTextZh: clippedText(input.footerTextZh ?? referralPosterCopy.footerTextZh, 220),
        footerTextEn: clippedText(input.footerTextEn ?? referralPosterCopy.footerTextEn, 220),
        foregroundColor: posterColor(input.foregroundColor, '主文字颜色'),
        accentColor: posterColor(input.accentColor, '强调颜色'),
        overlayOpacity: input.overlayOpacity,
    };
}

export function requiredText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
        throw new UserInputError(`${label}不能为空且不能超过${maxLength}个字符`);
    }
    return normalized;
}

function clippedText(value: string | null | undefined, maxLength: number): string {
    return (value?.trim() ?? '').slice(0, maxLength);
}

function posterColor(value: string, label: string): string {
    const normalized = value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalized)) {
        throw new UserInputError(`${label}必须使用 #RRGGBB 格式`);
    }
    return normalized;
}
