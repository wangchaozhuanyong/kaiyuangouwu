import { Injectable } from '@nestjs/common';
import {
    Asset,
    Channel,
    EntityNotFoundError,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { In } from 'typeorm';

import { StoreProfile } from './entities/store-profile.entity';
import { PublicStoreSummary, StoreProfileStatus, UpdateStoreProfileInput } from './types';

interface StorefrontChannelFields {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
}

@Injectable()
export class StoreProfileService {
    constructor(private readonly connection: TransactionalConnection) {}

    async createDraft(ctx: RequestContext, channel: Channel): Promise<StoreProfile> {
        const repository = this.connection.getRepository(ctx, StoreProfile);
        const existing = await repository.findOne({ where: { channelId: channel.id } });
        if (existing) {
            return existing;
        }
        const last = await repository.findOne({ order: { sortOrder: 'DESC' } });
        return repository.save(
            new StoreProfile({
                channel,
                channelId: channel.id,
                status: 'DRAFT',
                isPublished: false,
                sortOrder: (last?.sortOrder ?? -1) + 1,
                descriptionZh: '',
                descriptionEn: '',
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
        return this.attachDomains(ctx, profiles);
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
        this.assertStatus(status);
        if (input.sortOrder != null && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) {
            throw new UserInputError('网店排序必须是大于或等于 0 的整数');
        }

        profile.status = status;
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

        if (input.logoAssetId !== undefined) {
            const asset = input.logoAssetId == null ? null : await this.findAsset(ctx, input.logoAssetId);
            profile.logoAsset = asset;
            profile.logoAssetId = asset?.id ?? null;
        }

        if (status !== 'ACTIVE') {
            if (input.isPublished === true) {
                throw new UserInputError('只有 ACTIVE 状态的网店才能发布到 App');
            }
            profile.isPublished = false;
        } else if (input.isPublished != null) {
            if (input.isPublished) {
                await this.requireActivePrimaryDomain(ctx, profile.channelId);
            }
            profile.isPublished = input.isPublished;
        }

        const saved = await repository.save(profile);
        return (await this.attachDomains(ctx, [saved]))[0];
    }

    async findPublished(ctx: RequestContext): Promise<PublicStoreSummary[]> {
        const profiles = await this.connection.getRepository(ctx, StoreProfile).find({
            where: { status: 'ACTIVE', isPublished: true },
            relations: { channel: { seller: true }, logoAsset: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
        const hydrated = await this.attachDomains(ctx, profiles);
        return hydrated
            .filter(profile => profile.primaryDomain != null)
            .map(profile => {
                const customFields = profile.channel.customFields as StorefrontChannelFields;
                return {
                    id: profile.id,
                    channelId: profile.channelId,
                    code: profile.channel.code,
                    merchantName: profile.channel.seller?.name ?? profile.channel.code,
                    storefrontNameZh: customFields.storefrontNameZh?.trim() || profile.channel.code,
                    storefrontNameEn: customFields.storefrontNameEn?.trim() || profile.channel.code,
                    descriptionZh: profile.descriptionZh,
                    descriptionEn: profile.descriptionEn,
                    logo: profile.logoAsset,
                    domain: profile.primaryDomain as string,
                    storefrontUrl: profile.storefrontUrl as string,
                };
            });
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

    private async requireActivePrimaryDomain(ctx: RequestContext, channelId: ID): Promise<void> {
        const domain = await this.connection.getRepository(ctx, StoreDomain).findOne({
            where: { channelId, isPrimary: true, status: 'ACTIVE' },
        });
        if (!domain) {
            throw new UserInputError('发布到 App 前必须先绑定并验证主域名');
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
}
