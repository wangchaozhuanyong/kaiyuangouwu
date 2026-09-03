import { ID, RequestContext, TransactionalConnection, UserInputError, Asset } from '@vendure/core';
import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { SaveReferralPosterTemplateInput, referralPosterTemplates } from './referral.service';

export function requiredText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
        throw new UserInputError(`${label}不能为空且不能超过${maxLength}个字符`);
    }
    return normalized;
}

export function clippedText(value: string | null | undefined, maxLength: number): string {
    return (value?.trim() ?? '').slice(0, maxLength);
}

export function posterColor(value: string, label: string): string {
    const normalized = value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalized)) {
        throw new UserInputError(`${label}必须使用 #RRGGBB 格式`);
    }
    return normalized;
}

export async function validateDefaultPosterTemplate(
    ctx: RequestContext,
    connection: TransactionalConnection,
    id: string,
    enabledDefaultTemplates?: string[],
): Promise<void> {
    const allowedDefaults = enabledDefaultTemplates ?? referralPosterTemplates;
    if (allowedDefaults.includes(id as never)) return;
    const template = await connection.getRepository(ctx, ReferralPosterTemplate).findOne({
        where: { id, channelId: ctx.channelId, enabled: true },
    });
    if (!template) throw new UserInputError('默认海报模板无效或已停用');
}

export async function normalizePosterTemplateInput(
    ctx: RequestContext,
    assetForChannel: (ctx: RequestContext, id?: ID | null) => Promise<Asset | null>,
    input: SaveReferralPosterTemplateInput,
) {
    if (!Number.isInteger(input.position) || input.position < 0 || input.position > 100_000) {
        throw new UserInputError('模板排序必须是0至100000之间的整数');
    }
    if (input.layoutVariant !== 'STANDARD_CENTER') {
        throw new UserInputError('海报版式无效');
    }
    if (
        !Number.isInteger(input.overlayOpacity) ||
        input.overlayOpacity < 0 ||
        input.overlayOpacity > 80
    ) {
        throw new UserInputError('遮罩透明度必须在0至80之间');
    }
    const posterBackgroundAsset = await assetForChannel(ctx, input.posterBackgroundAssetId);
    const shareBackgroundAsset = await assetForChannel(ctx, input.shareBackgroundAssetId);
    return {
        name: requiredText(input.name, '模板名称', 128),
        enabled: input.enabled,
        position: input.position,
        layoutVariant: input.layoutVariant,
        posterBackgroundAssetId: posterBackgroundAsset?.id ?? null,
        shareBackgroundAssetId: shareBackgroundAsset?.id ?? null,
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
        featureOneTitleZh: clippedText(input.featureOneTitleZh ?? '热门工具汇集', 100),
        featureOneTitleEn: clippedText(input.featureOneTitleEn ?? '精选 AI tools', 100),
        featureOneTextZh: clippedText(input.featureOneTextZh ?? '多种 AI 工具任你选', 160),
        featureOneTextEn: clippedText(input.featureOneTextEn ?? 'A curated set of AI tools', 160),
        featureTwoTitleZh: clippedText(input.featureTwoTitleZh ?? '便捷开通服务', 100),
        featureTwoTitleEn: clippedText(input.featureTwoTitleEn ?? 'Fast activation', 100),
        featureTwoTextZh: clippedText(input.featureTwoTextZh ?? '快速开通 省时省心', 160),
        featureTwoTextEn: clippedText(input.featureTwoTextEn ?? 'Get started in a few clicks', 160),
        featureThreeTitleZh: clippedText(input.featureThreeTitleZh ?? '专属售后支持', 100),
        featureThreeTitleEn: clippedText(input.featureThreeTitleEn ?? 'Dedicated support', 100),
        featureThreeTextZh: clippedText(input.featureThreeTextZh ?? '专业客服 贴心服务', 160),
        featureThreeTextEn: clippedText(
            input.featureThreeTextEn ?? 'Friendly help when you need it',
            160,
        ),
        qrEyebrowZh: clippedText(input.qrEyebrowZh ?? '扫码访问云桥 AI', 100),
        qrEyebrowEn: clippedText(input.qrEyebrowEn ?? 'Scan CloudBridge AI', 100),
        qrTitleZh: clippedText(input.qrTitleZh ?? '发现更多实用 AI 服务', 140),
        qrTitleEn: clippedText(input.qrTitleEn ?? 'Discover practical AI services', 140),
        qrDescriptionZh: clippedText(input.qrDescriptionZh ?? '满足多种 AI 使用场景', 140),
        qrDescriptionEn: clippedText(
            input.qrDescriptionEn ?? 'Tools for work, creativity, learning and code',
            140,
        ),
        sceneOneZh: clippedText(input.sceneOneZh ?? '办公提效', 48),
        sceneOneEn: clippedText(input.sceneOneEn ?? 'Work', 48),
        sceneTwoZh: clippedText(input.sceneTwoZh ?? '内容创作', 48),
        sceneTwoEn: clippedText(input.sceneTwoEn ?? 'Create', 48),
        sceneThreeZh: clippedText(input.sceneThreeZh ?? '学习辅助', 48),
        sceneThreeEn: clippedText(input.sceneThreeEn ?? 'Learn', 48),
        sceneFourZh: clippedText(input.sceneFourZh ?? '智能编程', 48),
        sceneFourEn: clippedText(input.sceneFourEn ?? 'Code', 48),
        ctaTextZh: clippedText(input.ctaTextZh ?? '长按识别二维码，立即进入云桥 AI', 140),
        ctaTextEn: clippedText(input.ctaTextEn ?? 'Press and hold to enter CloudBridge AI', 140),
        footerTitleZh: clippedText(input.footerTitleZh ?? '让好用的 AI，真正为你所用', 160),
        footerTitleEn: clippedText(input.footerTitleEn ?? 'Put practical AI to work for you', 160),
        footerTextZh: clippedText(input.footerTextZh ?? '严选主流 AI 服务，合规稳定，退改无忧。', 240),
        footerTextEn: clippedText(
            input.footerTextEn ?? 'Curated mainstream AI services with reliable support and guarantee.',
            240,
        ),
        foregroundColor: posterColor(input.foregroundColor, '前景色'),
        accentColor: posterColor(input.accentColor, '强调色'),
        overlayOpacity: input.overlayOpacity,
    };
}
