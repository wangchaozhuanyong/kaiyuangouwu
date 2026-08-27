import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { ContentTranslationService } from '@vendure/content-translation-plugin';
import {
    Asset,
    EntityNotFoundError,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
    UserInputError,
} from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

import {
    authVisualCodeByType,
    DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS,
    MAX_HERO_AUTOPLAY_INTERVAL_SECONDS,
    MAX_STOREFRONT_CLIENT_PLUGINS,
    MAX_STOREFRONT_NAVIGATION_ITEMS,
    MIN_HERO_AUTOPLAY_INTERVAL_SECONDS,
    STOREFRONT_CLIENT_PLUGINS_CODE,
    STOREFRONT_NAVIGATION_CODE,
    storefrontClientPluginCodes,
    storefrontClientPluginPlacements,
    StorefrontContentBlockType,
    storefrontContentBlockTypes,
    storefrontContentLayoutVariants,
    StorefrontContentTargetType,
    storefrontContentTargetTypes,
    storefrontNavigationTargetPaths,
} from './constants';
import { StorefrontContentBlockTranslation } from './entities/storefront-content-block-translation.entity';
import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentItemTranslation } from './entities/storefront-content-item-translation.entity';
import { StorefrontContentItem } from './entities/storefront-content-item.entity';
import { StorefrontContentSettings } from './entities/storefront-content-settings.entity';
import { StorefrontExternalImageService } from './storefront-external-image.service';
import {
    ApplyStorefrontContentChangesInput,
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
        private readonly contentTranslations: ContentTranslationService,
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
        const published = blocks
            .filter(
                block => (!block.startsAt || block.startsAt <= now) && (!block.endsAt || block.endsAt > now),
            )
            .filter(block => this.hasCompletePublishedTranslations(block))
            .map(block => this.translateBlock(block, ctx, true));
        return published.filter(block => block.type !== 'HERO' || this.hasPublishedImage(block));
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
        if (normalized.type === 'NAVIGATION') this.validateNavigationItems(input.items ?? []);
        if (normalized.type === 'CLIENT_PLUGINS') this.validateClientPluginItems(input.items ?? []);
        this.validateAuthVisual(normalized, input.items ?? []);
        await this.assertUniqueCode(ctx, normalized.code);
        const image = await this.resolveImage(ctx, normalized.imageAssetId, normalized.imageUrl, '区块图片');
        this.assertEnabledHeroHasImage(normalized.type, normalized.enabled, image);
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
        const block = await this.lockOwnedBlockOrThrow(ctx, input.id);
        this.assertExpectedUpdatedAt(block.updatedAt, input.expectedUpdatedAt);
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
        this.validateAuthVisual(
            next,
            input.items ??
                block.items.map(item => ({
                    id: item.id,
                    enabled: item.enabled,
                    position: item.position,
                    imageAssetId: item.imageAssetId,
                    imageUrl: item.imageUrl,
                    targetType: item.targetType,
                    targetValue: item.targetValue,
                    settings: item.settings,
                    translations: item.translations.map(translation => ({
                        languageCode: translation.languageCode,
                        label: translation.label,
                        description: translation.description,
                    })),
                })),
        );
        const effectiveItems =
            input.items ??
            block.items.map(item => ({
                id: item.id,
                enabled: item.enabled,
                position: item.position,
                imageAssetId: item.imageAssetId,
                imageUrl: item.imageUrl,
                targetType: item.targetType,
                targetValue: item.targetValue,
                settings: item.settings,
                translations: item.translations.map(translation => ({
                    languageCode: translation.languageCode,
                    label: translation.label,
                    description: translation.description,
                })),
            }));
        if (next.type === 'NAVIGATION') this.validateNavigationItems(effectiveItems);
        if (next.type === 'CLIENT_PLUGINS') this.validateClientPluginItems(effectiveItems);
        await this.assertUniqueCode(ctx, next.code, block.id);
        const requestedImageUrl =
            input.imageAssetId === null && input.imageUrl === undefined ? null : next.imageUrl;
        const image = await this.resolveImage(ctx, next.imageAssetId, requestedImageUrl, '区块图片');
        this.assertEnabledHeroHasImage(next.type, next.enabled, image);
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

    async applyChanges(
        ctx: RequestContext,
        input: ApplyStorefrontContentChangesInput,
    ): Promise<StorefrontContentBlock[]> {
        await this.lockAndAssertBlockVersions(ctx, input.expectedBlocks);
        this.assertUniqueBatchTargets(input);

        for (const updateInput of input.updates) {
            await this.update(ctx, updateInput);
        }
        for (const createInput of input.creates) {
            await this.create(ctx, createInput);
        }
        if (input.orderedCodes) {
            await this.reorderByCodes(ctx, input.orderedCodes);
        }
        return this.findAllForAdmin(ctx);
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

    private async lockAndAssertBlockVersions(
        ctx: RequestContext,
        expectedBlocks: ApplyStorefrontContentChangesInput['expectedBlocks'],
    ): Promise<void> {
        const expectedById = new Map(
            expectedBlocks.map(block => [String(block.id), block.expectedUpdatedAt]),
        );
        if (expectedById.size !== expectedBlocks.length) {
            throw new UserInputError('CONCURRENT_MODIFICATION: 内容版本列表包含重复项，请刷新后重试');
        }

        try {
            await this.connection
                .getRepository(ctx, StorefrontContentBlock)
                .createQueryBuilder('block')
                .setLock('pessimistic_write')
                .where('block.channelId = :channelId', { channelId: ctx.channelId })
                .orderBy('block.id', 'ASC')
                .getMany();
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }

        const currentBlocks = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId },
        });
        if (
            currentBlocks.length !== expectedBlocks.length ||
            currentBlocks.some(block => !expectedById.has(String(block.id)))
        ) {
            throw new UserInputError(
                'CONCURRENT_MODIFICATION: 装修区块列表已被其他管理员更改，请重新载入后操作',
            );
        }
        for (const block of currentBlocks) {
            this.assertExpectedUpdatedAt(block.updatedAt, expectedById.get(String(block.id)) as Date);
        }
    }

    private assertUniqueBatchTargets(input: ApplyStorefrontContentChangesInput): void {
        const updateIds = input.updates.map(update => String(update.id));
        const createCodes = input.creates.map(create => create.code.trim().toLowerCase());
        if (
            new Set(updateIds).size !== updateIds.length ||
            new Set(createCodes).size !== createCodes.length
        ) {
            throw new UserInputError('批量装修操作包含重复区块');
        }
    }

    private async reorderByCodes(ctx: RequestContext, codes: string[]): Promise<void> {
        const normalizedCodes = codes.map(code => code.trim().toLowerCase());
        if (new Set(normalizedCodes).size !== normalizedCodes.length) {
            throw new UserInputError('装修区块排序包含重复编码');
        }
        const blocks = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId },
        });
        const blocksByCode = new Map(blocks.map(block => [block.code.toLowerCase(), block]));
        if (
            blocks.length !== normalizedCodes.length ||
            normalizedCodes.some(code => !blocksByCode.has(code))
        ) {
            throw new UserInputError('排序必须包含当前店铺的全部装修区块');
        }
        normalizedCodes.forEach((code, position) => {
            const block = blocksByCode.get(code);
            if (block) block.position = position;
        });
        await this.connection.getRepository(ctx, StorefrontContentBlock).save(blocks);
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
        if (block.type === 'NAVIGATION') this.validateNavigationItems(inputs);
        if (block.type === 'CLIENT_PLUGINS') this.validateClientPluginItems(inputs);
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
        const existing = await repository.find({ where: { base: { id: block.id } } });
        const source = inputs.find(input => input.languageCode === LanguageCode.zh_Hans);
        if (!source) throw new UserInputError('必须填写简体中文内容');
        const target = inputs.find(input => input.languageCode === LanguageCode.en);
        const existingSource = existing.find(input => input.languageCode === LanguageCode.zh_Hans);
        const existingTarget = existing.find(input => input.languageCode === LanguageCode.en);
        const prepared = await this.contentTranslations.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: source.title,
                targetText: target?.title,
                existingSourceText: existingSource?.title,
                existingTargetText: existingTarget?.title,
                required: true,
            },
            {
                path: 'subtitle',
                sourceText: source.subtitle ?? '',
                targetText: target?.subtitle,
                existingSourceText: existingSource?.subtitle,
                existingTargetText: existingTarget?.subtitle,
            },
            {
                path: 'body',
                sourceText: source.body ?? '',
                targetText: target?.body,
                existingSourceText: existingSource?.body,
                existingTargetText: existingTarget?.body,
                format: 'HTML',
            },
            {
                path: 'ctaLabel',
                sourceText: source.ctaLabel ?? '',
                targetText: target?.ctaLabel,
                existingSourceText: existingSource?.ctaLabel,
                existingTargetText: existingTarget?.ctaLabel,
            },
        ]);
        const english = new Map(prepared.map(field => [field.path, field.translatedText]));
        const normalizedInputs: StorefrontContentBlockTranslationInput[] = [
            source,
            {
                languageCode: LanguageCode.en,
                title: english.get('title') ?? '',
                subtitle: english.get('subtitle') ?? '',
                body: english.get('body') ?? '',
                ctaLabel: english.get('ctaLabel') ?? '',
            },
        ];
        await repository.delete({ base: { id: block.id } });
        await repository.save(
            normalizedInputs.map(
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
        await this.contentTranslations.recordPreparedFields(
            ctx,
            {
                channelId: ctx.channelId,
                entityType: StorefrontContentBlock.name,
                entityId: block.id,
            },
            prepared,
        );
    }

    private async replaceItemTranslations(
        ctx: RequestContext,
        item: StorefrontContentItem,
        inputs: StorefrontContentItemTranslationInput[],
    ): Promise<void> {
        this.validateTranslations(inputs, 'label');
        const repository = this.connection.getRepository(ctx, StorefrontContentItemTranslation);
        const existing = await repository.find({ where: { base: { id: item.id } } });
        const source = inputs.find(input => input.languageCode === LanguageCode.zh_Hans);
        if (!source) throw new UserInputError('必须填写简体中文内容');
        const target = inputs.find(input => input.languageCode === LanguageCode.en);
        const existingSource = existing.find(input => input.languageCode === LanguageCode.zh_Hans);
        const existingTarget = existing.find(input => input.languageCode === LanguageCode.en);
        const prepared = await this.contentTranslations.prepareLocalizedFields([
            {
                path: 'label',
                sourceText: source.label,
                targetText: target?.label,
                existingSourceText: existingSource?.label,
                existingTargetText: existingTarget?.label,
                required: true,
            },
            {
                path: 'description',
                sourceText: source.description ?? '',
                targetText: target?.description,
                existingSourceText: existingSource?.description,
                existingTargetText: existingTarget?.description,
            },
        ]);
        const english = new Map(prepared.map(field => [field.path, field.translatedText]));
        const normalizedInputs: StorefrontContentItemTranslationInput[] = [
            source,
            {
                languageCode: LanguageCode.en,
                label: english.get('label') ?? '',
                description: english.get('description') ?? '',
            },
        ];
        await repository.delete({ base: { id: item.id } });
        await repository.save(
            normalizedInputs.map(
                input =>
                    new StorefrontContentItemTranslation({
                        base: item,
                        languageCode: input.languageCode,
                        label: input.label.trim(),
                        description: input.description?.trim() ?? '',
                    }),
            ),
        );
        await this.contentTranslations.recordPreparedFields(
            ctx,
            {
                channelId: ctx.channelId,
                entityType: StorefrontContentItem.name,
                entityId: item.id,
            },
            prepared,
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

    private hasCompletePublishedTranslations(block: StorefrontContentBlock): boolean {
        const source = block.translations?.find(
            translation => translation.languageCode === LanguageCode.zh_Hans,
        );
        const target = block.translations?.find(translation => translation.languageCode === LanguageCode.en);
        if (!source?.title.trim() || !target?.title.trim()) return false;
        const blockFields = ['subtitle', 'body', 'ctaLabel'] as const;
        if (blockFields.some(field => Boolean(source[field].trim()) !== Boolean(target[field].trim()))) {
            return false;
        }
        return (block.items ?? [])
            .filter(item => item.enabled)
            .every(item => {
                const itemSource = item.translations?.find(
                    translation => translation.languageCode === LanguageCode.zh_Hans,
                );
                const itemTarget = item.translations?.find(
                    translation => translation.languageCode === LanguageCode.en,
                );
                return (
                    Boolean(itemSource?.label.trim()) &&
                    Boolean(itemTarget?.label.trim()) &&
                    Boolean(itemSource?.description.trim()) === Boolean(itemTarget?.description.trim())
                );
            });
    }

    private hasPublishedImage(block: StorefrontContentBlock): boolean {
        return Boolean(block.imageUrl?.trim());
    }

    private assertEnabledHeroHasImage(
        type: StorefrontContentBlockType,
        enabled: boolean,
        image: ResolvedStorefrontImage,
    ): void {
        if (type === 'HERO' && enabled && !image.imageUrl?.trim()) {
            throw new UserInputError('轮播图上线前必须从素材库选择或上传图片');
        }
    }

    private async getOwnedBlockOrThrow(ctx: RequestContext, id: ID): Promise<StorefrontContentBlock> {
        const block = await this.findOwnedBlock(ctx, id, true);
        if (!block) {
            throw new EntityNotFoundError(StorefrontContentBlock.name, id);
        }
        return block;
    }

    private async lockOwnedBlockOrThrow(ctx: RequestContext, id: ID): Promise<StorefrontContentBlock> {
        const repository = this.connection.getRepository(ctx, StorefrontContentBlock);
        try {
            const locked = await repository
                .createQueryBuilder('block')
                .setLock('pessimistic_write')
                .where('block.id = :id', { id })
                .andWhere('block.channelId = :channelId', { channelId: ctx.channelId })
                .getOne();
            if (!locked) {
                throw new EntityNotFoundError(StorefrontContentBlock.name, id);
            }
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }
        return this.getOwnedBlockOrThrow(ctx, id);
    }

    private assertExpectedUpdatedAt(current: Date, expected: Date | string): void {
        const expectedDate = expected instanceof Date ? expected : new Date(expected);
        if (!Number.isFinite(expectedDate.getTime()) || current.getTime() !== expectedDate.getTime()) {
            throw new UserInputError(
                'CONCURRENT_MODIFICATION: 该内容已被其他管理员更新，请重新载入后合并修改',
            );
        }
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
        if (
            (input.type === 'NAVIGATION' && code !== STOREFRONT_NAVIGATION_CODE) ||
            (input.type !== 'NAVIGATION' && code === STOREFRONT_NAVIGATION_CODE)
        ) {
            throw new UserInputError('客户端导航必须使用系统保留编码');
        }
        if (
            (input.type === 'CLIENT_PLUGINS' && code !== STOREFRONT_CLIENT_PLUGINS_CODE) ||
            (input.type !== 'CLIENT_PLUGINS' && code === STOREFRONT_CLIENT_PLUGINS_CODE)
        ) {
            throw new UserInputError('客户端插件配置必须使用系统保留编码');
        }
        const authVisualType = input.type as keyof typeof authVisualCodeByType;
        const requiredAuthVisualCode = authVisualCodeByType[authVisualType];
        const reservedAuthVisualCodes = Object.values(authVisualCodeByType);
        if (
            (requiredAuthVisualCode && code !== requiredAuthVisualCode) ||
            (!requiredAuthVisualCode && reservedAuthVisualCodes.some(reservedCode => reservedCode === code))
        ) {
            throw new UserInputError('登录注册页视觉必须使用对应的系统保留编码');
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

    private validateAuthVisual(
        input: ReturnType<StorefrontContentService['validateBlockInput']>,
        items: StorefrontContentItemInput[],
    ): void {
        if (input.type !== 'AUTH_LOGIN' && input.type !== 'AUTH_REGISTER') return;
        if (input.layoutVariant !== 'HERO_OVERLAY' || input.targetType !== 'NONE') {
            throw new UserInputError('登录注册页视觉必须使用主视觉叠加布局且不能配置跳转');
        }
        if (input.startsAt || input.endsAt) {
            throw new UserInputError('登录注册页视觉不能设置定时上下线');
        }
        const source = input.translations.find(
            translation => translation.languageCode === LanguageCode.zh_Hans,
        );
        if (!source?.ctaLabel?.trim() || !source.subtitle?.trim()) {
            throw new UserInputError('登录注册页视觉必须填写中文顶部短句和说明文案');
        }
        if (
            items.length !== 3 ||
            new Set(items.map(item => item.position)).size !== 3 ||
            items.some(item => item.position < 0 || item.position > 2)
        ) {
            throw new UserInputError('登录注册页视觉必须包含三个顺序固定的卖点标签');
        }
        const accentColor = input.settings?.accentColor;
        if (
            accentColor != null &&
            (typeof accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(accentColor))
        ) {
            throw new UserInputError('登录注册页标签强调色必须使用六位十六进制颜色');
        }
    }

    private validateNavigationItems(inputs: StorefrontContentItemInput[]): void {
        if (!inputs.length || inputs.length > MAX_STOREFRONT_NAVIGATION_ITEMS) {
            throw new UserInputError(`客户端导航必须包含 1 到 ${MAX_STOREFRONT_NAVIGATION_ITEMS} 个项目`);
        }
        if (!inputs.some(item => item.enabled !== false)) {
            throw new UserInputError('客户端导航至少需要启用一个项目');
        }
        for (const input of inputs) {
            if ((input.targetType ?? 'NONE') !== 'PAGE') {
                throw new UserInputError('客户端导航只能跳转到站内页面');
            }
            const target = input.targetValue?.trim();
            if (
                !storefrontNavigationTargetPaths.includes(
                    target as (typeof storefrontNavigationTargetPaths)[number],
                )
            ) {
                throw new UserInputError('客户端导航包含不支持的站内页面');
            }
        }
    }

    private validateClientPluginItems(inputs: StorefrontContentItemInput[]): void {
        if (inputs.length > MAX_STOREFRONT_CLIENT_PLUGINS) {
            throw new UserInputError(`客户端插件最多可以添加 ${MAX_STOREFRONT_CLIENT_PLUGINS} 个`);
        }
        const pluginCodes = new Set<string>();
        for (const input of inputs) {
            if ((input.targetType ?? 'NONE') !== 'NONE' || input.targetValue?.trim()) {
                throw new UserInputError('客户端插件不能配置独立跳转目标');
            }
            const settings = this.normalizeSettings(input.settings, '客户端插件设置');
            const pluginCode = settings?.pluginCode;
            const placement = settings?.placement;
            const categoryScope = settings?.categoryScope ?? 'ALL';
            const categoryIds = settings?.categoryIds ?? [];
            const includeChildren = settings?.includeChildren ?? true;
            if (typeof pluginCode !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginCode)) {
                throw new UserInputError('客户端插件编码格式不正确');
            }
            if (pluginCodes.has(pluginCode)) throw new UserInputError('同一个客户端插件不能重复添加');
            if (!storefrontClientPluginCodes.includes(pluginCode)) {
                throw new UserInputError('客户端插件尚未在平台发布');
            }
            pluginCodes.add(pluginCode);
            if (
                typeof placement !== 'string' ||
                !storefrontClientPluginPlacements.includes(
                    placement as (typeof storefrontClientPluginPlacements)[number],
                )
            ) {
                throw new UserInputError('客户端插件包含不支持的显示位置');
            }
            if (categoryScope !== 'ALL' && categoryScope !== 'SELECTED') {
                throw new UserInputError('客户端插件分类显示范围不正确');
            }
            if (
                !Array.isArray(categoryIds) ||
                categoryIds.length > 200 ||
                categoryIds.some(id => typeof id !== 'string' || !id.trim()) ||
                new Set(categoryIds).size !== categoryIds.length
            ) {
                throw new UserInputError('客户端插件分类配置不正确');
            }
            if (
                placement !== 'BUSINESS_SERVICES_MAIN' &&
                categoryScope === 'SELECTED' &&
                !categoryIds.length
            ) {
                throw new UserInputError('指定分类显示时至少需要选择一个分类');
            }
            if (typeof includeChildren !== 'boolean') {
                throw new UserInputError('客户端插件子分类设置不正确');
            }
        }
    }

    private validateTranslations<T extends { languageCode: LanguageCode }>(
        inputs: T[],
        requiredKey: 'title' | 'label',
    ): void {
        if (!inputs.length) {
            throw new UserInputError('必须填写简体中文内容');
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
        if (!languageCodes.has(LanguageCode.zh_Hans)) {
            throw new UserInputError('必须填写简体中文内容');
        }
        if ([...languageCodes].some(code => code !== 'zh_Hans' && code !== 'en')) {
            throw new UserInputError('当前仅支持简体中文和英语');
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

function isLockNotSupportedError(error: unknown): boolean {
    return (
        error instanceof LockNotSupportedOnGivenDriverError ||
        (error instanceof Error &&
            (error.name === 'LockNotSupportedOnGivenDriverError' ||
                error.message.toLowerCase().includes('locking not supported')))
    );
}
