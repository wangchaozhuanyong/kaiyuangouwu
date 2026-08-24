import { Injectable } from '@nestjs/common';
import {
    Asset,
    Channel,
    ChannelService,
    EntityNotFoundError,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    idsAreEqual,
    isGraphQlErrorResult,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { In } from 'typeorm';

import { StoreProfile } from './entities/store-profile.entity';
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
    ) {}

    async createDraft(ctx: RequestContext, channel: Channel): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const existing = await repository.findOne({ where: { channelId: channel.id } });
        if (existing) {
            return existing;
        }
        const [last] = await repository.find({ order: { sortOrder: 'DESC' }, take: 1 });
        return repository.save(
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
            }),
        );
    }

    async findAllForAdmin(ctx: RequestContext): Promise<StoreProfile[]> {
        const profiles = await this.connection.getRepository(ctx, StoreProfile).find({
            relations: { channel: { seller: true }, logoAsset: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
        return this.attachOperationalState(ctx, profiles);
    }

    async findForMerchant(ctx: RequestContext): Promise<StoreProfile> {
        const profile = await this.findByChannel(ctx, ctx.channelId);
        return (await this.attachOperationalState(ctx, [profile]))[0];
    }

    async update(ctx: RequestContext, input: UpdateStoreProfileInput): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const profile = await repository.findOne({
            where: { id: input.id },
            relations: { channel: { seller: true }, logoAsset: true },
        });
        if (!profile) {
            throw new EntityNotFoundError(StoreProfile.name, input.id);
        }

        const status = input.status ?? profile.status;
        const activating = profile.status !== 'ACTIVE' && status === 'ACTIVE';
        this.assertStatus(status);
        if (input.sortOrder != null && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) {
            throw new UserInputError('网店排序必须是大于或等于 0 的整数');
        }

        profile.status = status;
        profile.isPublished = false;
        profile.sortOrder = input.sortOrder ?? profile.sortOrder;
        profile.descriptionZh = this.normalizeDescription(
            input.descriptionZh,
            profile.descriptionZh,
            '中文简介',
        );
        profile.descriptionEn = this.normalizeDescription(
            input.descriptionEn,
            profile.descriptionEn,
            '英文简介',
        );
        profile.internalNote = this.normalizeInternalNote(input.internalNote, profile.internalNote);
        await this.updateStorefrontNames(ctx, profile, input.storefrontNameZh, input.storefrontNameEn);

        if (input.logoAssetId !== undefined) {
            const asset = input.logoAssetId == null ? null : await this.findAsset(ctx, input.logoAssetId);
            profile.logoAsset = asset;
            profile.logoAssetId = asset?.id ?? null;
        }

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
        return (await this.attachOperationalState(ctx, [saved]))[0];
    }

    async updateForMerchant(ctx: RequestContext, input: UpdateMyStoreProfileInput): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const profile = await this.findByChannel(ctx, ctx.channelId);
        profile.descriptionZh = this.normalizeDescription(
            input.descriptionZh,
            profile.descriptionZh,
            '中文简介',
        );
        profile.descriptionEn = this.normalizeDescription(
            input.descriptionEn,
            profile.descriptionEn,
            '英文简介',
        );
        if (input.logoAssetId !== undefined) {
            const asset = input.logoAssetId == null ? null : await this.findAsset(ctx, input.logoAssetId);
            profile.logoAsset = asset;
            profile.logoAssetId = asset?.id ?? null;
        }

        await this.updateStorefrontNames(ctx, profile, input.storefrontNameZh, input.storefrontNameEn);

        const saved = await repository.save(profile);
        return (await this.attachOperationalState(ctx, [saved]))[0];
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

    private async findByChannel(ctx: RequestContext, channelId: ID): Promise<StoreProfile> {
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId },
            relations: { channel: { seller: true }, logoAsset: true },
        });
        if (!profile) {
            throw new EntityNotFoundError(StoreProfile.name, channelId);
        }
        return profile;
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
