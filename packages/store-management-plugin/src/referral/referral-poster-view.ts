import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Asset,
    ConfigService,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import { In } from 'typeorm';

import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { ReferralProgramConfig } from '../entities/referral-program-config.entity';
import { convertChannelAmount } from '../store-currency-price-selection-strategy';

import { normalizeReferralPosterInput, SaveReferralPosterTemplateInput } from './referral-input';
import {
    effectivePosterDefault,
    enabledPosterIds,
    referralPosterContentCode,
    referralPosterCopy,
    referralPosterPresets,
} from './referral-poster-presets';
import { referralPosterTemplates } from './referral.constants';

export class ReferralPosterView {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
    ) {}

    async configView(ctx: RequestContext, config: ReferralProgramConfig, includeDisabled: boolean) {
        const posterTemplateConfigs = await this.connection.getRepository(ctx, ReferralPosterTemplate).find({
            where: {
                channelId: ctx.channelId,
                ...(includeDisabled ? {} : { enabled: true }),
            },
            relations: {
                posterBackgroundAsset: true,
                shareBackgroundAsset: true,
            },
            order: { position: 'ASC', id: 'ASC' },
        });
        const minimumOrderAmount =
            convertChannelAmount(ctx, config.minimumOrderAmount, config.currencyCode, ctx.currencyCode) ?? 0;
        const maxRewardPerOrder =
            config.maxRewardPerOrder == null
                ? null
                : convertChannelAmount(ctx, config.maxRewardPerOrder, config.currencyCode, ctx.currencyCode);
        const posterTemplates =
            config.posterTemplates == null
                ? [...referralPosterTemplates]
                : config.posterTemplates.filter(id => referralPosterTemplates.includes(id as never));
        return {
            channelId: config.channelId,
            updatedAt: config.updatedAt,
            enabled: config.enabled,
            rewardRate: config.rewardRateBps / 100,
            releaseDelayDays: config.releaseDelayDays,
            currencyCode: ctx.currencyCode,
            minimumOrderAmount,
            maxRewardPerOrder,
            allowBalanceSpend: config.allowBalanceSpend,
            attributionWindowDays: config.attributionWindowDays,
            defaultPosterTemplate: this.publicPosterId(
                effectivePosterDefault(
                    config.defaultPosterTemplate,
                    enabledPosterIds(posterTemplates, posterTemplateConfigs),
                ),
            ),
            posterTemplates,
            systemPosterTemplateConfigs: await this.systemPosterTemplates(ctx, posterTemplates),
            posterTemplateConfigs,
        };
    }

    publicPosterId(id: string): string {
        if (!id || referralPosterTemplates.includes(id as never)) return id;
        const strategy =
            this.configService.entityOptions.entityIdStrategy ?? this.configService.entityIdStrategy;
        const entityId = strategy.primaryKeyType === 'increment' ? Number(id) : id;
        return String(strategy.encodeId(entityId));
    }

    async systemPosterTemplates(ctx: RequestContext, enabledIds: string[]) {
        // The content plugin is optional in minimal test environments.
        const blocks = this.connection.rawConnection.hasMetadata(StorefrontContentBlock)
            ? await this.connection.getRepository(ctx, StorefrontContentBlock).find({
                  where: {
                      channelId: ctx.channelId,
                      code: In(referralPosterPresets.map(preset => referralPosterContentCode(preset.id))),
                  },
                  relations: { imageAsset: true },
              })
            : [];
        return referralPosterPresets.map((preset, position) => {
            const block = blocks.find(item => item.code === referralPosterContentCode(preset.id));
            const settings = block?.settings as Record<string, any> | undefined;
            const configured =
                settings?.purpose === 'referral-system-poster' && settings?.templateId === preset.id;
            const copy = Object.fromEntries(
                Object.entries(referralPosterCopy).map(([field, fallback]) => [
                    field,
                    configured && typeof settings?.copy?.[field] === 'string'
                        ? settings.copy[field]
                        : fallback,
                ]),
            );
            return {
                ...copy,
                id: preset.id,
                createdAt: block?.createdAt ?? new Date(0),
                updatedAt: block?.updatedAt ?? new Date(0),
                name:
                    ctx.languageCode === LanguageCode.zh_Hans || ctx.languageCode === LanguageCode.zh_Hant
                        ? preset.nameZh
                        : preset.nameEn,
                enabled: enabledIds.includes(preset.id),
                position,
                layoutVariant: 'STANDARD_CENTER',
                posterBackgroundAsset: configured ? (block?.imageAsset ?? null) : null,
                shareBackgroundAsset: null,
                foregroundColor: configured
                    ? block?.textColor || preset.foregroundColor
                    : preset.foregroundColor,
                accentColor:
                    configured && typeof settings?.accentColor === 'string'
                        ? settings.accentColor
                        : preset.accentColor,
                overlayOpacity: 0,
                design: configured ? { ...preset.design, ...settings.design } : preset.design,
            };
        });
    }

    async normalizePosterTemplateInput(
        ctx: RequestContext,
        input: SaveReferralPosterTemplateInput,
        existing?: ReferralPosterTemplate,
    ) {
        input = {
            ...existing,
            ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
        } as SaveReferralPosterTemplateInput;
        const normalized = normalizeReferralPosterInput(input);
        const posterBackgroundAsset = await this.assetForChannel(ctx, input.posterBackgroundAssetId);
        const shareBackgroundAsset = await this.assetForChannel(ctx, input.shareBackgroundAssetId);
        return {
            ...normalized,
            posterBackgroundAssetId: posterBackgroundAsset?.id ?? null,
            shareBackgroundAssetId: shareBackgroundAsset?.id ?? null,
        };
    }

    private async assetForChannel(ctx: RequestContext, id?: ID | null): Promise<Asset | null> {
        if (id == null || id === '') return null;
        const asset = await this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('asset')
            .innerJoin('asset.channels', 'assetChannel', 'assetChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('asset.id = :id', { id })
            .getOne();
        if (!asset) throw new UserInputError('图片不存在或不属于当前店铺');
        if (!asset.mimeType?.startsWith('image/')) throw new UserInputError('海报背景必须是图片');
        return asset;
    }
}
