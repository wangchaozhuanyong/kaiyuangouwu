import { Injectable, Optional } from '@nestjs/common';
import {
    ContentTranslationService,
    LocalizedContentFieldInput,
    PreparedLocalizedContentField,
} from '@vendure/content-translation-plugin';
import {
    Asset,
    Channel,
    ChannelService,
    EntityNotFoundError,
    EventBus,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    idsAreEqual,
    isGraphQlErrorResult,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { In, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontDataChangedEvent } from './realtime/storefront-data-changed.event';
import { StoreActivationReadinessService } from './store-activation-readiness.service';
import { isOperationalStorefront } from './storefront-activation.service';
import { StoreProfileStatus, UpdateMyStoreProfileInput, UpdateStoreProfileInput } from './types';

interface StorefrontChannelFields {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
}

@Injectable()
export class StoreProfileService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
        private readonly activationReadinessService: StoreActivationReadinessService,
        private readonly translations: ContentTranslationService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

    async createDraft(ctx: RequestContext, channel: Channel): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const existing = await repository.findOne({
            where: { channelId: channel.id },
            relations: this.profileRelations(),
        });
        if (existing) {
            return existing;
        }
        const [last] = await repository.find({ order: { sortOrder: 'DESC' }, take: 1 });
        try {
            return await repository.save(
                new StoreProfile({
                    channel,
                    channelId: channel.id,
                    status: 'DRAFT',
                    isPublished: false,
                    sortOrder: (last?.sortOrder ?? -1) + 1,
                    descriptionZh: '',
                    descriptionEn: '',
                    internalNote: '',
                    logoAsset: null,
                    logoAssetId: null,
                    logoOnLightAsset: null,
                    logoOnLightAssetId: null,
                    logoOnDarkAsset: null,
                    logoOnDarkAssetId: null,
                    taglineZh: null,
                    taglineEn: null,
                    brandBackgroundColor: null,
                    brandPrimaryColor: null,
                    brandAccentColor: null,
                    brandHighlightColor: null,
                }),
            );
        } catch (error) {
            // API requests may discover the same legacy gap concurrently. The unique Channel index
            // is authoritative; return the winner instead of surfacing a transient duplicate error.
            const concurrentlyCreated = await repository.findOne({
                where: { channelId: channel.id },
                relations: this.profileRelations(),
            });
            if (concurrentlyCreated) {
                return concurrentlyCreated;
            }
            throw error;
        }
    }

    async findAllForAdmin(ctx: RequestContext): Promise<StoreProfile[]> {
        const profiles = await this.connection.getRepository(ctx, StoreProfile).find({
            relations: this.profileRelations(),
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
        return this.attachOperationalState(ctx, profiles);
    }

    async findForMerchant(ctx: RequestContext): Promise<StoreProfile> {
        let profile = await this.findByChannel(ctx, ctx.channelId, false);
        if (!profile) {
            const channel = await this.channelService.findOne(ctx, ctx.channelId);
            if (!channel) {
                throw new EntityNotFoundError(Channel.name, ctx.channelId);
            }
            const isProvisioningTemplate = Boolean(
                (channel.customFields as { isStoreProvisioningTemplate?: boolean } | undefined)
                    ?.isStoreProvisioningTemplate,
            );
            if (isProvisioningTemplate) {
                throw new EntityNotFoundError(StoreProfile.name, ctx.channelId);
            }
            profile = await this.createDraft(ctx, channel);
        }
        return (await this.attachOperationalState(ctx, [profile]))[0];
    }

    async update(ctx: RequestContext, input: UpdateStoreProfileInput): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const profile = await this.lockProfileById(ctx, input.id);
        this.assertExpectedUpdatedAt(profile.updatedAt, input.expectedUpdatedAt);

        const status = input.status ?? profile.status;
        const activating = profile.status !== 'ACTIVE' && status === 'ACTIVE';
        this.assertStatus(status);
        if (input.sortOrder != null && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) {
            throw new UserInputError('网店排序必须是大于或等于 0 的整数');
        }

        profile.status = status;
        profile.isPublished = false;
        profile.sortOrder = input.sortOrder ?? profile.sortOrder;
        const prepared = await this.prepareProfileTranslations(input, profile);
        const localized = new Map(prepared.map(field => [field.path, field.translatedText]));
        profile.descriptionZh = this.normalizeDescription(
            input.descriptionZh,
            profile.descriptionZh,
            '中文简介',
        );
        profile.descriptionEn = this.normalizeDescription(
            localized.get('description') ?? input.descriptionEn,
            profile.descriptionEn,
            '英文简介',
        );
        profile.internalNote = this.normalizeInternalNote(input.internalNote, profile.internalNote);
        profile.taglineZh = this.normalizeTagline(input.taglineZh, profile.taglineZh, '中文品牌口号');
        profile.taglineEn = this.normalizeTagline(
            localized.get('tagline') ?? input.taglineEn,
            profile.taglineEn,
            '英文品牌口号',
        );
        this.updateBrandColors(profile, input);
        await this.updateStorefrontNames(
            ctx,
            profile,
            input.storefrontNameZh,
            localized.get('storefrontName') ?? input.storefrontNameEn,
        );

        if (input.logoAssetId !== undefined) {
            const asset = input.logoAssetId == null ? null : await this.findAsset(ctx, input.logoAssetId);
            profile.logoAsset = asset;
            profile.logoAssetId = asset?.id ?? null;
        }
        await this.updateBrandAssets(ctx, profile, input);

        if (activating) {
            const readiness = await this.activationReadinessService.get(ctx, profile);
            if (!readiness.ready) {
                const missing = readiness.checks
                    .filter(check => !check.ready)
                    .map(check => check.message)
                    .join('；');
                throw new UserInputError(`店铺尚未达到上线条件：${missing}`);
            }
        }

        const saved = await repository.save(profile);
        await this.recordProfileTranslationState(ctx, saved, prepared);
        await this.publishChanged(ctx, saved);
        return (await this.attachOperationalState(ctx, [saved]))[0];
    }

    async updateForMerchant(ctx: RequestContext, input: UpdateMyStoreProfileInput): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const profile = await this.lockProfileByChannel(ctx, ctx.channelId);
        this.assertExpectedUpdatedAt(profile.updatedAt, input.expectedUpdatedAt);
        const prepared = await this.prepareProfileTranslations(input, profile);
        const localized = new Map(prepared.map(field => [field.path, field.translatedText]));
        profile.descriptionZh = this.normalizeDescription(
            input.descriptionZh,
            profile.descriptionZh,
            '中文简介',
        );
        profile.descriptionEn = this.normalizeDescription(
            localized.get('description') ?? input.descriptionEn,
            profile.descriptionEn,
            '英文简介',
        );
        profile.taglineZh = this.normalizeTagline(input.taglineZh, profile.taglineZh, '中文品牌口号');
        profile.taglineEn = this.normalizeTagline(
            localized.get('tagline') ?? input.taglineEn,
            profile.taglineEn,
            '英文品牌口号',
        );
        this.updateBrandColors(profile, input);
        if (input.logoAssetId !== undefined) {
            const asset = input.logoAssetId == null ? null : await this.findAsset(ctx, input.logoAssetId);
            profile.logoAsset = asset;
            profile.logoAssetId = asset?.id ?? null;
        }
        await this.updateBrandAssets(ctx, profile, input);

        await this.updateStorefrontNames(
            ctx,
            profile,
            input.storefrontNameZh,
            localized.get('storefrontName') ?? input.storefrontNameEn,
        );

        const saved = await repository.save(profile);
        await this.recordProfileTranslationState(ctx, saved, prepared);
        await this.publishChanged(ctx, saved);
        return (await this.attachOperationalState(ctx, [saved]))[0];
    }

    private async publishChanged(ctx: RequestContext, profile: StoreProfile): Promise<void> {
        await this.eventBus?.publish(
            new StorefrontDataChangedEvent(ctx, ['config'], {
                channelIds: [profile.channelId],
                entityType: 'StoreProfile',
                entityIds: [profile.id],
            }),
        );
    }

    private async prepareProfileTranslations(
        input: UpdateStoreProfileInput | UpdateMyStoreProfileInput,
        profile: StoreProfile,
    ): Promise<PreparedLocalizedContentField[]> {
        const fields: LocalizedContentFieldInput[] = [];
        const customFields = profile.channel.customFields as StorefrontChannelFields;
        if (input.storefrontNameZh != null || input.storefrontNameEn != null) {
            fields.push({
                path: 'storefrontName',
                sourceText: this.normalizeStorefrontName(
                    input.storefrontNameZh,
                    customFields.storefrontNameZh,
                    '中文店铺名称',
                ),
                targetText: input.storefrontNameEn,
                existingSourceText: customFields.storefrontNameZh,
                existingTargetText: customFields.storefrontNameEn,
                required: true,
            });
        }
        if (input.descriptionZh != null || input.descriptionEn != null) {
            fields.push({
                path: 'description',
                sourceText: this.normalizeDescription(input.descriptionZh, profile.descriptionZh, '中文简介'),
                targetText: input.descriptionEn,
                existingSourceText: profile.descriptionZh,
                existingTargetText: profile.descriptionEn,
            });
        }
        if (input.taglineZh != null || input.taglineEn != null) {
            fields.push({
                path: 'tagline',
                sourceText: this.normalizeTagline(input.taglineZh, profile.taglineZh, '中文品牌口号') ?? '',
                targetText: input.taglineEn,
                existingSourceText: profile.taglineZh,
                existingTargetText: profile.taglineEn,
            });
        }
        return this.translations.prepareLocalizedFields(fields);
    }

    private recordProfileTranslationState(
        ctx: RequestContext,
        profile: StoreProfile,
        prepared: PreparedLocalizedContentField[],
    ): Promise<void> {
        return this.translations.recordPreparedFields(
            ctx,
            {
                channelId: profile.channelId,
                entityType: StoreProfile.name,
                entityId: profile.id,
            },
            prepared,
        );
    }

    private async attachOperationalState(
        ctx: RequestContext,
        profiles: StoreProfile[],
    ): Promise<StoreProfile[]> {
        await this.attachDomains(ctx, profiles);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        for (const profile of profiles) {
            profile.isOperational = isOperationalStorefront({
                isDefaultChannel: idsAreEqual(profile.channelId, defaultChannel.id),
                status: profile.status,
                isPlatformOwned:
                    Boolean(profile.channel.sellerId) &&
                    idsAreEqual(profile.channel.sellerId, defaultChannel.sellerId),
                hasVerifiedPrimaryDomain: Boolean(profile.primaryDomain),
            });
        }
        await Promise.all(
            profiles.map(async profile => {
                profile.activationReadiness = await this.activationReadinessService.get(ctx, profile);
            }),
        );
        return profiles;
    }

    private async attachDomains(ctx: RequestContext, profiles: StoreProfile[]): Promise<StoreProfile[]> {
        const channelIds = profiles.map(profile => profile.channelId);
        if (channelIds.length === 0) {
            return profiles;
        }
        const domains = await this.connection.getRepository(ctx, StoreDomain).find({
            where: { channelId: In(channelIds), isPrimary: true, status: 'ACTIVE' },
        });
        const domainByChannel = new Map(domains.map(domain => [String(domain.channelId), domain.domain]));
        for (const profile of profiles) {
            const domain = domainByChannel.get(String(profile.channelId)) ?? null;
            profile.primaryDomain = domain;
            profile.storefrontUrl = domain ? `https://${domain}` : null;
        }
        return profiles;
    }

    private async findByChannel(ctx: RequestContext, channelId: ID, required?: true): Promise<StoreProfile>;
    private async findByChannel(
        ctx: RequestContext,
        channelId: ID,
        required: false,
    ): Promise<StoreProfile | undefined>;
    private async findByChannel(
        ctx: RequestContext,
        channelId: ID,
        required = true,
    ): Promise<StoreProfile | undefined> {
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId },
            relations: this.profileRelations(),
        });
        if (!profile && required) {
            throw new EntityNotFoundError(StoreProfile.name, channelId);
        }
        return profile ?? undefined;
    }

    private async lockProfileById(ctx: RequestContext, id: ID): Promise<StoreProfile> {
        await this.lockProfileRow(ctx, 'profile.id = :id', { id });
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { id },
            relations: this.profileRelations(),
        });
        if (!profile) throw new EntityNotFoundError(StoreProfile.name, id);
        await this.lockChannelRow(ctx, profile.channelId);
        return (await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { id },
            relations: this.profileRelations(),
        })) as StoreProfile;
    }

    private async lockProfileByChannel(ctx: RequestContext, channelId: ID): Promise<StoreProfile> {
        await this.lockProfileRow(ctx, 'profile.channelId = :channelId', { channelId });
        await this.lockChannelRow(ctx, channelId);
        return this.findByChannel(ctx, channelId);
    }

    private async lockProfileRow(
        ctx: RequestContext,
        where: string,
        parameters: Record<string, ID>,
    ): Promise<void> {
        try {
            const locked = await this.connection
                .getRepository(ctx, StoreProfile)
                .createQueryBuilder('profile')
                .setLock('pessimistic_write')
                .where(where, parameters)
                .getOne();
            if (!locked) throw new EntityNotFoundError(StoreProfile.name, Object.values(parameters)[0]);
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }
    }

    private async lockChannelRow(ctx: RequestContext, channelId: ID): Promise<void> {
        try {
            const locked = await this.connection
                .getRepository(ctx, Channel)
                .createQueryBuilder('channel')
                .setLock('pessimistic_write')
                .where('channel.id = :channelId', { channelId })
                .getOne();
            if (!locked) throw new EntityNotFoundError(Channel.name, channelId);
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }
    }

    private assertExpectedUpdatedAt(current: Date, expected: Date | string): void {
        const expectedDate = expected instanceof Date ? expected : new Date(expected);
        if (!Number.isFinite(expectedDate.getTime()) || current.getTime() !== expectedDate.getTime()) {
            throw new UserInputError(
                'CONCURRENT_MODIFICATION: 店铺资料已被其他管理员更新，请重新载入后合并修改',
            );
        }
    }

    private async findAsset(ctx: RequestContext, id: ID): Promise<Asset> {
        const asset = await this.connection.getRepository(ctx, Asset).findOne({ where: { id } });
        if (!asset) {
            throw new EntityNotFoundError(Asset.name, id);
        }
        return asset;
    }

    private assertStatus(status: StoreProfileStatus): void {
        if (!(['DRAFT', 'ACTIVE', 'SUSPENDED'] as StoreProfileStatus[]).includes(status)) {
            throw new UserInputError('网店状态无效');
        }
    }

    private normalizeDescription(value: string | null | undefined, current: string, label: string): string {
        if (value == null) {
            return current;
        }
        const normalized = value.trim();
        if (normalized.length > 800) {
            throw new UserInputError(`${label}不能超过 800 个字符`);
        }
        return normalized;
    }

    private normalizeInternalNote(value: string | null | undefined, current: string | null): string | null {
        if (value == null) {
            return current;
        }
        const normalized = value.trim();
        if (normalized.length > 2_000) {
            throw new UserInputError('内部备注不能超过 2000 个字符');
        }
        return normalized;
    }

    private normalizeTagline(
        value: string | null | undefined,
        current: string | null,
        label: string,
    ): string | null {
        if (value == null) {
            return current;
        }
        const normalized = value.trim();
        if (normalized.length > 160) {
            throw new UserInputError(`${label}不能超过 160 个字符`);
        }
        return normalized || null;
    }

    private updateBrandColors(
        profile: StoreProfile,
        input: UpdateStoreProfileInput | UpdateMyStoreProfileInput,
    ): void {
        profile.brandBackgroundColor = this.normalizeBrandColor(
            input.brandBackgroundColor,
            profile.brandBackgroundColor,
            '品牌背景色',
        );
        profile.brandPrimaryColor = this.normalizeBrandColor(
            input.brandPrimaryColor,
            profile.brandPrimaryColor,
            '品牌主色',
        );
        profile.brandAccentColor = this.normalizeBrandColor(
            input.brandAccentColor,
            profile.brandAccentColor,
            '品牌强调色',
        );
        profile.brandHighlightColor = this.normalizeBrandColor(
            input.brandHighlightColor,
            profile.brandHighlightColor,
            '品牌高亮色',
        );
    }

    private normalizeBrandColor(
        value: string | null | undefined,
        current: string | null,
        label: string,
    ): string | null {
        if (value === undefined) return current;
        if (value == null || value.trim() === '') return null;
        const normalized = value.trim().toUpperCase();
        if (!/^#[0-9A-F]{6}$/u.test(normalized)) {
            throw new UserInputError(`${label}必须使用 #RRGGBB 格式`);
        }
        return normalized;
    }

    private async updateBrandAssets(
        ctx: RequestContext,
        profile: StoreProfile,
        input: UpdateStoreProfileInput | UpdateMyStoreProfileInput,
    ): Promise<void> {
        if (input.logoOnLightAssetId !== undefined) {
            const asset =
                input.logoOnLightAssetId == null ? null : await this.findAsset(ctx, input.logoOnLightAssetId);
            profile.logoOnLightAsset = asset;
            profile.logoOnLightAssetId = asset?.id ?? null;
        }
        if (input.logoOnDarkAssetId !== undefined) {
            const asset =
                input.logoOnDarkAssetId == null ? null : await this.findAsset(ctx, input.logoOnDarkAssetId);
            profile.logoOnDarkAsset = asset;
            profile.logoOnDarkAssetId = asset?.id ?? null;
        }
    }

    private profileRelations() {
        return {
            channel: { seller: true },
            logoAsset: true,
            logoOnLightAsset: true,
            logoOnDarkAsset: true,
        } as const;
    }

    private normalizeStorefrontName(
        value: string | null | undefined,
        current: string | null | undefined,
        label: string,
    ): string {
        if (value == null) {
            return current?.trim() ?? '';
        }
        const normalized = value.trim();
        const units = Array.from(normalized).reduce(
            (total, character) => total + (/\p{Script=Han}|[\uFF01-\uFF60]/u.test(character) ? 2 : 1),
            0,
        );
        if (units < 1 || units > 16) {
            throw new UserInputError(`${label}必须是 1 至 16 个显示单位`);
        }
        return normalized;
    }

    private async updateStorefrontNames(
        ctx: RequestContext,
        profile: StoreProfile,
        storefrontNameZhInput: string | null | undefined,
        storefrontNameEnInput: string | null | undefined,
    ): Promise<void> {
        if (storefrontNameZhInput == null && storefrontNameEnInput == null) {
            return;
        }
        const customFields = profile.channel.customFields as StorefrontChannelFields;
        const storefrontNameZh = this.normalizeStorefrontName(
            storefrontNameZhInput,
            customFields.storefrontNameZh,
            '中文店铺名称',
        );
        const storefrontNameEn = this.normalizeStorefrontName(
            storefrontNameEnInput,
            customFields.storefrontNameEn,
            '英文店铺名称',
        );
        const updatedChannel = await this.channelService.update(ctx, {
            id: profile.channelId,
            customFields: {
                ...customFields,
                storefrontNameZh,
                storefrontNameEn,
            },
        });
        if (isGraphQlErrorResult(updatedChannel)) {
            throw new UserInputError(updatedChannel.message);
        }
        profile.channel = updatedChannel;
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
