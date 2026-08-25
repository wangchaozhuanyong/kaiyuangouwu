import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    EntityNotFoundError,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
    UserInputError,
} from '@vendure/core';

import {
    DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS,
    MAX_HERO_AUTOPLAY_INTERVAL_SECONDS,
    MIN_HERO_AUTOPLAY_INTERVAL_SECONDS,
    StorefrontContentBlockType,
    storefrontContentBlockTypes,
    storefrontContentLayoutVariants,
    StorefrontContentTargetType,
    storefrontContentTargetTypes,
} from './constants';
import { StorefrontContentBlockTranslation } from './entities/storefront-content-block-translation.entity';
import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentItemTranslation } from './entities/storefront-content-item-translation.entity';
import { StorefrontContentItem } from './entities/storefront-content-item.entity';
import { StorefrontContentSettings } from './entities/storefront-content-settings.entity';
import { StorefrontExternalImageService } from './storefront-external-image.service';
import {
    CreateStorefrontContentBlockInput,
    StorefrontContentBlockTranslationInput,
    StorefrontContentItemInput,
    StorefrontContentItemTranslationInput,
    StorefrontContentSettingsValue,
    UpdateStorefrontContentBlockInput,
    UpdateStorefrontContentSettingsInput,
} from './types';

interface ResolvedStorefrontImage {
    asset: Asset | null;
    imageUrl: string | null;
}

@Injectable()
export class StorefrontContentService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly translator: TranslatorService,
        private readonly externalImageService: StorefrontExternalImageService,
    ) {}

    async findAllForAdmin(ctx: RequestContext): Promise<StorefrontContentBlock[]> {
        const blocks = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId },
            relations: {
                imageAsset: true,
                items: { imageAsset: true, translations: true },
                translations: true,
            },
            order: { position: 'ASC', createdAt: 'ASC', items: { position: 'ASC', createdAt: 'ASC' } },
        });
        return blocks.map(block => this.translateBlock(block, ctx, false));
    }

    async findOneForAdmin(ctx: RequestContext, id: ID): Promise<StorefrontContentBlock | undefined> {
        const block = await this.findOwnedBlock(ctx, id, true);
        return block ? this.translateBlock(block, ctx, false) : undefined;
    }

    async findPublished(ctx: RequestContext): Promise<StorefrontContentBlock[]> {
        const now = new Date();
        const blocks = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId, enabled: true },
            relations: {
                imageAsset: true,
                items: { imageAsset: true, translations: true },
                translations: true,
            },
            order: { position: 'ASC', createdAt: 'ASC', items: { position: 'ASC', createdAt: 'ASC' } },
        });
        return blocks
            .filter(
                block => (!block.startsAt || block.startsAt <= now) && (!block.endsAt || block.endsAt > now),
            )
            .map(block => this.translateBlock(block, ctx, true));
    }

    async getSettings(ctx: RequestContext): Promise<{
        heroAutoplayIntervalSeconds: number;
        configuredBlockTypes: StorefrontContentBlockType[];
    }> {
        const [settings, blocks] = await Promise.all([
            this.connection.getRepository(ctx, StorefrontContentSettings).findOne({
                where: { channelId: ctx.channelId },
            }),
            this.connection.getRepository(ctx, StorefrontContentBlock).find({
                where: { channelId: ctx.channelId },
                select: { type: true },
            }),
        ]);
        return {
            heroAutoplayIntervalSeconds:
                settings?.heroAutoplayIntervalSeconds ?? DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS,
            configuredBlockTypes: Array.from(new Set(blocks.map(block => block.type))),
        };
    }

    async updateSettings(
        ctx: RequestContext,
        input: UpdateStorefrontContentSettingsInput,
    ): Promise<{ heroAutoplayIntervalSeconds: number; configuredBlockTypes: StorefrontContentBlockType[] }> {
        this.validateHeroAutoplayInterval(input.heroAutoplayIntervalSeconds);
        const repository = this.connection.getRepository(ctx, StorefrontContentSettings);
        const settings =
            (await repository.findOne({ where: { channelId: ctx.channelId } })) ??
            new StorefrontContentSettings({
                channel: ctx.channel,
                channelId: ctx.channelId,
            });
        settings.heroAutoplayIntervalSeconds = input.heroAutoplayIntervalSeconds;
        const saved = await repository.save(settings);
        const configuredBlockTypes = (
            await this.connection.getRepository(ctx, StorefrontContentBlock).find({
                where: { channelId: ctx.channelId },
                select: { type: true },
            })
        ).map(block => block.type);
        return {
            heroAutoplayIntervalSeconds: saved.heroAutoplayIntervalSeconds,
            configuredBlockTypes: Array.from(new Set(configuredBlockTypes)),
        };
    }

    async create(
        ctx: RequestContext,
        input: CreateStorefrontContentBlockInput,
    ): Promise<StorefrontContentBlock> {
        const normalized = this.validateBlockInput(input);
        await this.assertUniqueCode(ctx, normalized.code);
        const image = await this.resolveImage(ctx, normalized.imageAssetId, normalized.imageUrl, '区块图片');
        const block = await this.connection.getRepository(ctx, StorefrontContentBlock).save(
            new StorefrontContentBlock({
                ...normalized,
                imageAsset: image.asset,
                imageAssetId: image.asset?.id ?? null,
                imageUrl: image.imageUrl,
                channel: ctx.channel,
                channelId: ctx.channelId,
                translations: [],
                items: [],
            }),
        );
        await this.replaceBlockTranslations(ctx, block, input.translations);
        await this.syncItems(ctx, block, input.items ?? []);
        return this.translateBlock(await this.getOwnedBlockOrThrow(ctx, block.id), ctx, false);
    }

    async update(
        ctx: RequestContext,
        input: UpdateStorefrontContentBlockInput,
    ): Promise<StorefrontContentBlock> {
        const block = await this.getOwnedBlockOrThrow(ctx, input.id);
        const next = this.validateBlockInput({
            code: input.code ?? block.code,
            internalName: input.internalName ?? block.internalName,
            type: input.type ?? block.type,
            layoutVariant: input.layoutVariant ?? block.layoutVariant,
            enabled: input.enabled ?? block.enabled,
            position: input.position ?? block.position,
            startsAt: input.startsAt === undefined ? block.startsAt : input.startsAt,
            endsAt: input.endsAt === undefined ? block.endsAt : input.endsAt,
            imageAssetId: input.imageAssetId === undefined ? block.imageAssetId : input.imageAssetId,
            imageUrl: input.imageUrl === undefined ? block.imageUrl : input.imageUrl,
            backgroundColor:
                input.backgroundColor === undefined ? block.backgroundColor : input.backgroundColor,
            textColor: input.textColor === undefined ? block.textColor : input.textColor,
            targetType: input.targetType ?? block.targetType,
            targetValue: input.targetValue === undefined ? block.targetValue : input.targetValue,
            settings: input.settings === undefined ? block.settings : input.settings,
            translations:
                input.translations ??
                block.translations.map(translation => ({
                    languageCode: translation.languageCode,
                    title: translation.title,
                    subtitle: translation.subtitle,
                    body: translation.body,
                    ctaLabel: translation.ctaLabel,
                })),
            items: input.items,
        });
        await this.assertUniqueCode(ctx, next.code, block.id);
        const requestedImageUrl =
            input.imageAssetId === null && input.imageUrl === undefined ? null : next.imageUrl;
        const image = await this.resolveImage(ctx, next.imageAssetId, requestedImageUrl, '区块图片');
        Object.assign(block, {
            code: next.code,
            internalName: next.internalName,
            type: next.type,
            layoutVariant: next.layoutVariant,
            enabled: next.enabled,
            position: next.position,
            startsAt: next.startsAt,
            endsAt: next.endsAt,
            imageAsset: image.asset,
            imageAssetId: image.asset?.id ?? null,
            imageUrl: image.imageUrl,
            backgroundColor: next.backgroundColor,
            textColor: next.textColor,
            targetType: next.targetType,
            targetValue: next.targetValue,
            settings: next.settings,
        });
        await this.connection.getRepository(ctx, StorefrontContentBlock).save(block);
        if (input.translations) {
            await this.replaceBlockTranslations(ctx, block, input.translations);
        }
        if (input.items) {
            await this.syncItems(ctx, block, input.items);
        }
        return this.translateBlock(await this.getOwnedBlockOrThrow(ctx, block.id), ctx, false);
    }

    async reorder(ctx: RequestContext, ids: ID[]): Promise<StorefrontContentBlock[]> {
        const uniqueIds = new Set(ids.map(String));
        if (uniqueIds.size !== ids.length) {
            throw new UserInputError('装修区块排序包含重复项');
        }
        const blocks = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId },
        });
        if (blocks.length !== ids.length || blocks.some(block => !uniqueIds.has(String(block.id)))) {
            throw new UserInputError('排序必须包含当前店铺的全部装修区块');
        }
        const positionById = new Map(ids.map((id, index) => [String(id), index]));
        for (const block of blocks) {
            block.position = positionById.get(String(block.id)) ?? block.position;
        }
        await this.connection.getRepository(ctx, StorefrontContentBlock).save(blocks);
        return this.findAllForAdmin(ctx);
    }

    async delete(ctx: RequestContext, id: ID): Promise<{ result: 'DELETED'; message: string }> {
        const block = await this.getOwnedBlockOrThrow(ctx, id);
        await this.connection.getRepository(ctx, StorefrontContentBlock).remove(block);
        return { result: 'DELETED', message: '店铺装修区块已删除' };
    }

    private async syncItems(
        ctx: RequestContext,
        block: StorefrontContentBlock,
        inputs: StorefrontContentItemInput[],
    ): Promise<void> {
        const existing = await this.connection.getRepository(ctx, StorefrontContentItem).find({
            where: { blockId: block.id },
            relations: { imageAsset: true, translations: true },
        });
        const existingById = new Map(existing.map(item => [String(item.id), item]));
        const retained = new Set<string>();

        for (const input of inputs) {
            this.validateItemInput(input, block.type);
            let item: StorefrontContentItem;
            if (input.id != null) {
                item = existingById.get(String(input.id)) as StorefrontContentItem;
                if (!item) {
                    throw new UserInputError('装修条目不存在或不属于当前区块');
                }
                retained.add(String(item.id));
                const imageAssetId =
                    input.imageAssetId === undefined ? item.imageAssetId : input.imageAssetId;
                const requestedImageUrl =
                    input.imageAssetId === null && input.imageUrl === undefined
                        ? null
                        : (this.optionalText(input.imageUrl) ?? item.imageUrl);
                const image = await this.resolveImage(ctx, imageAssetId, requestedImageUrl, '条目图片');
                Object.assign(item, {
                    enabled: input.enabled ?? true,
                    position: input.position,
                    imageAsset: image.asset,
                    imageAssetId: image.asset?.id ?? null,
                    imageUrl: image.imageUrl,
                    targetType: input.targetType ?? 'NONE',
                    targetValue: this.normalizeTarget(input.targetType ?? 'NONE', input.targetValue),
                    settings:
                        input.settings === undefined
                            ? item.settings
                            : this.normalizeSettings(input.settings, '条目设置'),
                });
            } else {
                const image = await this.resolveImage(
                    ctx,
                    input.imageAssetId,
                    this.optionalText(input.imageUrl),
                    '条目图片',
                );
                item = new StorefrontContentItem({
                    block,
                    blockId: block.id,
                    enabled: input.enabled ?? true,
                    position: input.position,
                    imageAsset: image.asset,
                    imageAssetId: image.asset?.id ?? null,
                    imageUrl: image.imageUrl,
                    targetType: input.targetType ?? 'NONE',
                    targetValue: this.normalizeTarget(input.targetType ?? 'NONE', input.targetValue),
                    settings: this.normalizeSettings(input.settings, '条目设置'),
                    translations: [],
                });
            }
            const saved = await this.connection.getRepository(ctx, StorefrontContentItem).save(item);
            retained.add(String(saved.id));
            await this.replaceItemTranslations(ctx, saved, input.translations);
        }

        const removed = existing.filter(item => !retained.has(String(item.id)));
        if (removed.length) {
            await this.connection.getRepository(ctx, StorefrontContentItem).remove(removed);
        }
    }

    private async replaceBlockTranslations(
        ctx: RequestContext,
        block: StorefrontContentBlock,
        inputs: StorefrontContentBlockTranslationInput[],
    ): Promise<void> {
        this.validateTranslations(inputs, 'title');
        const repository = this.connection.getRepository(ctx, StorefrontContentBlockTranslation);
        await repository.delete({ base: { id: block.id } });
        await repository.save(
            inputs.map(
                input =>
                    new StorefrontContentBlockTranslation({
                        base: block,
                        languageCode: input.languageCode,
                        title: input.title.trim(),
                        subtitle: input.subtitle?.trim() ?? '',
                        body: input.body?.trim() ?? '',
                        ctaLabel: input.ctaLabel?.trim() ?? '',
                    }),
            ),
        );
    }

    private async replaceItemTranslations(
        ctx: RequestContext,
        item: StorefrontContentItem,
        inputs: StorefrontContentItemTranslationInput[],
    ): Promise<void> {
        this.validateTranslations(inputs, 'label');
        const repository = this.connection.getRepository(ctx, StorefrontContentItemTranslation);
        await repository.delete({ base: { id: item.id } });
        await repository.save(
            inputs.map(
                input =>
                    new StorefrontContentItemTranslation({
                        base: item,
                        languageCode: input.languageCode,
                        label: input.label.trim(),
                        description: input.description?.trim() ?? '',
                    }),
            ),
        );
    }

    private translateBlock(
        block: StorefrontContentBlock,
        ctx: RequestContext,
        publishedOnly: boolean,
    ): StorefrontContentBlock {
        const translated = this.translator.translate(block, ctx, ['items']) as StorefrontContentBlock;
        translated.internalName = translated.internalName?.trim() || translated.title || translated.code;
        translated.layoutVariant = translated.layoutVariant || 'AUTO';
        translated.imageUrl =
            (translated.imageAsset ? this.externalImageService.storefrontUrl(translated.imageAsset) : null) ??
            (publishedOnly ? this.publishedLegacyImageUrl(translated.imageUrl) : translated.imageUrl);
        translated.items = (translated.items ?? [])
            .filter(item => !publishedOnly || item.enabled)
            .map(item => {
                item.imageUrl =
                    (item.imageAsset ? this.externalImageService.storefrontUrl(item.imageAsset) : null) ??
                    (publishedOnly ? this.publishedLegacyImageUrl(item.imageUrl) : item.imageUrl);
                return item;
            })
            .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));
        return translated;
    }

    private async getOwnedBlockOrThrow(ctx: RequestContext, id: ID): Promise<StorefrontContentBlock> {
        const block = await this.findOwnedBlock(ctx, id, true);
        if (!block) {
            throw new EntityNotFoundError(StorefrontContentBlock.name, id);
        }
        return block;
    }

    private findOwnedBlock(
        ctx: RequestContext,
        id: ID,
        withRelations: boolean,
    ): Promise<StorefrontContentBlock | null> {
        return this.connection.getRepository(ctx, StorefrontContentBlock).findOne({
            where: { id, channelId: ctx.channelId },
            ...(withRelations
                ? {
                      relations: {
                          imageAsset: true,
                          items: { imageAsset: true, translations: true },
                          translations: true,
                      },
                      order: { items: { position: 'ASC' as const, createdAt: 'ASC' as const } },
                  }
                : {}),
        });
    }

    private async assertUniqueCode(ctx: RequestContext, code: string, excludingId?: ID): Promise<void> {
        const existing = await this.connection.getRepository(ctx, StorefrontContentBlock).findOne({
            where: { channelId: ctx.channelId, code },
        });
        if (existing && (excludingId == null || String(existing.id) !== String(excludingId))) {
            throw new UserInputError('当前店铺已存在相同编码的装修区块');
        }
    }

    private validateBlockInput(input: CreateStorefrontContentBlockInput) {
        const code = input.code.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(code)) {
            throw new UserInputError('区块编码只能使用小写字母、数字和短横线，最长 64 个字符');
        }
        if (!storefrontContentBlockTypes.includes(input.type)) {
            throw new UserInputError('不支持的装修区块类型');
        }
        const internalName =
            input.internalName?.trim() ||
            input.translations
                .find(translation => translation.languageCode === LanguageCode.zh_Hans)
                ?.title?.trim() ||
            input.translations[0]?.title?.trim() ||
            code;
        if (internalName.length > 128) {
            throw new UserInputError('模块内部名称不能超过 128 个字符');
        }
        const layoutVariant = input.layoutVariant ?? 'AUTO';
        if (!storefrontContentLayoutVariants.includes(layoutVariant)) {
            throw new UserInputError('不支持的模块展示样式');
        }
        if (!Number.isInteger(input.position) || input.position < 0) {
            throw new UserInputError('区块排序必须是非负整数');
        }
        const startsAt = input.startsAt ? new Date(input.startsAt) : null;
        const endsAt = input.endsAt ? new Date(input.endsAt) : null;
        if (startsAt && Number.isNaN(startsAt.getTime())) {
            throw new UserInputError('区块开始时间格式不正确');
        }
        if (endsAt && Number.isNaN(endsAt.getTime())) {
            throw new UserInputError('区块结束时间格式不正确');
        }
        if (startsAt && endsAt && startsAt >= endsAt) {
            throw new UserInputError('区块结束时间必须晚于开始时间');
        }
        this.validateTranslations(input.translations, 'title');
        this.validateImageUrl(input.imageUrl, '区块图片');
        this.validateColor(input.backgroundColor, '背景颜色');
        this.validateColor(input.textColor, '文字颜色');
        const targetType = input.targetType ?? 'NONE';
        return {
            code,
            internalName,
            type: input.type,
            layoutVariant,
            enabled: input.enabled ?? true,
            position: input.position,
            startsAt,
            endsAt,
            imageAssetId: input.imageAssetId ?? null,
            imageUrl: this.optionalText(input.imageUrl),
            backgroundColor: this.optionalText(input.backgroundColor),
            textColor: this.optionalText(input.textColor),
            targetType,
            targetValue: this.normalizeTarget(targetType, input.targetValue),
            settings: this.normalizeSettings(input.settings, '模块设置'),
            translations: input.translations,
            items: input.items,
        };
    }

    private validateItemInput(
        input: StorefrontContentItemInput,
        blockType?: StorefrontContentBlockType,
    ): void {
        if (!Number.isInteger(input.position) || input.position < 0) {
            throw new UserInputError('装修条目排序必须是非负整数');
        }
        this.validateTranslations(input.translations, 'label');
        this.validateImageUrl(input.imageUrl, '条目图片');
        const targetType = input.targetType ?? 'NONE';
        this.normalizeTarget(targetType, input.targetValue);
        if (blockType === 'COUPONS' && targetType !== 'COUPON') {
            throw new UserInputError('优惠券专区的每个条目都必须填写优惠码');
        }
    }

    private validateTranslations<T extends { languageCode: LanguageCode }>(
        inputs: T[],
        requiredKey: 'title' | 'label',
    ): void {
        if (!inputs.length) {
            throw new UserInputError('至少需要一种语言的内容');
        }
        const languageCodes = new Set<string>();
        for (const input of inputs) {
            if (languageCodes.has(input.languageCode)) {
                throw new UserInputError('同一种语言不能重复');
            }
            languageCodes.add(input.languageCode);
            const requiredValue = (input as unknown as Record<string, unknown>)[requiredKey];
            if (typeof requiredValue !== 'string' || !requiredValue.trim()) {
                throw new UserInputError(requiredKey === 'title' ? '区块标题不能为空' : '条目名称不能为空');
            }
        }
    }

    private normalizeTarget(type: StorefrontContentTargetType, value?: string | null): string | null {
        if (!storefrontContentTargetTypes.includes(type)) {
            throw new UserInputError('不支持的跳转目标类型');
        }
        const normalized = this.optionalText(value);
        if (type === 'NONE') {
            return null;
        }
        if (!normalized) {
            throw new UserInputError('已选择跳转类型时必须填写跳转目标');
        }
        if (type === 'URL') {
            this.validateUrl(normalized, '跳转链接');
        }
        return normalized;
    }

    private validateUrl(value: string | null | undefined, label: string): void {
        const normalized = this.optionalText(value);
        if (!normalized) {
            return;
        }
        if (normalized.startsWith('/') || normalized.startsWith('#/')) {
            return;
        }
        try {
            const url = new URL(normalized);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                throw new Error();
            }
        } catch {
            throw new UserInputError(`${label}必须是站内路径或 HTTP(S) 地址`);
        }
    }

    private validateImageUrl(value: string | null | undefined, label: string): void {
        const normalized = this.optionalText(value);
        if (!normalized) return;
        if (normalized.startsWith('/assets/')) return;
        try {
            const url = new URL(normalized);
            if (url.protocol === 'https:' || url.protocol === 'http:') return;
        } catch {
            // Fall through to the image-specific error below.
        }
        throw new UserInputError(`${label}必须从素材库选择，或填写可公开访问的 HTTP(S) 图片地址`);
    }

    private validateColor(value: string | null | undefined, label: string): void {
        const normalized = this.optionalText(value);
        if (normalized && !/^#[0-9a-f]{6}$/i.test(normalized)) {
            throw new UserInputError(`${label}必须使用六位十六进制颜色，例如 #ffffff`);
        }
    }

    private validateHeroAutoplayInterval(value: number): void {
        if (
            !Number.isInteger(value) ||
            value < MIN_HERO_AUTOPLAY_INTERVAL_SECONDS ||
            value > MAX_HERO_AUTOPLAY_INTERVAL_SECONDS
        ) {
            throw new UserInputError(
                `轮播自动切换间隔必须是 ${MIN_HERO_AUTOPLAY_INTERVAL_SECONDS} 到 ${MAX_HERO_AUTOPLAY_INTERVAL_SECONDS} 秒之间的整数`,
            );
        }
    }

    private async findAsset(ctx: RequestContext, id: ID | null | undefined): Promise<Asset | null> {
        if (id == null) {
            return null;
        }
        const asset = await this.connection.getRepository(ctx, Asset).findOne({ where: { id } });
        if (!asset) {
            throw new EntityNotFoundError(Asset.name, id);
        }
        return asset;
    }

    private async resolveImage(
        ctx: RequestContext,
        imageAssetId: ID | null | undefined,
        imageUrl: string | null | undefined,
        label: string,
    ): Promise<ResolvedStorefrontImage> {
        const asset = await this.findAsset(ctx, imageAssetId);
        if (asset) {
            return { asset, imageUrl: this.externalImageService.storefrontUrl(asset) };
        }
        const normalizedUrl = this.optionalText(imageUrl);
        if (!normalizedUrl) {
            return { asset: null, imageUrl: null };
        }
        if (normalizedUrl.startsWith('/assets/')) {
            return { asset: null, imageUrl: normalizedUrl };
        }
        try {
            const importedAsset = await this.externalImageService.import(ctx, normalizedUrl);
            return {
                asset: importedAsset,
                imageUrl: this.externalImageService.storefrontUrl(importedAsset),
            };
        } catch (error) {
            if (error instanceof UserInputError) throw error;
            throw new UserInputError(`${label}导入失败，请改为上传到素材库`);
        }
    }

    private publishedLegacyImageUrl(imageUrl: string | null): string | null {
        return imageUrl?.trim().startsWith('/assets/') ? imageUrl.trim() : null;
    }

    private normalizeSettings(
        value: StorefrontContentSettingsValue | null | undefined,
        label: string,
    ): StorefrontContentSettingsValue | null {
        if (value == null) {
            return null;
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new UserInputError(`${label}格式不正确`);
        }
        const serialized = JSON.stringify(value);
        if (serialized.length > 20_000) {
            throw new UserInputError(`${label}内容不能超过 20000 个字符`);
        }
        return JSON.parse(serialized) as StorefrontContentSettingsValue;
    }

    private optionalText(value: string | null | undefined): string | null {
        return value?.trim() || null;
    }
}
