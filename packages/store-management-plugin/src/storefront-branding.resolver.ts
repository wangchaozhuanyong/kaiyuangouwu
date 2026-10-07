import { Optional } from '@nestjs/common';
import { Mutation, Query, Resolver } from '@nestjs/graphql';
import { getLocalizedMetadata } from '@vendure/common/lib/display-localization';
import { isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import type { Asset } from '@vendure/core';
import {
    Allow,
    ConfigService,
    Ctx,
    ForbiddenError,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { StorefrontActivationService } from './storefront-activation.service';

interface StorefrontChannelFields {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
}

@Resolver()
export class StorefrontBrandingShopResolver {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private activation: StorefrontActivationService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async storefrontBranding(@Ctx() ctx: RequestContext) {
        return this.loadBranding(ctx);
    }

    async loadBranding(ctx: RequestContext) {
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId: ctx.channelId },
            relations: { logoAsset: true, logoOnLightAsset: true, logoOnDarkAsset: true },
        });

        const customFields = (ctx.channel.customFields ?? {}) as StorefrontChannelFields;
        const isChinese = String(ctx.languageCode).toLowerCase().startsWith('zh');
        const name = getLocalizedMetadata(
            {
                zh: customFields.storefrontNameZh,
                en: isUsableEnglishTranslation(customFields.storefrontNameEn)
                    ? customFields.storefrontNameEn
                    : null,
            },
            isChinese ? 'zh' : 'en',
        );
        const description = isChinese
            ? profile?.descriptionZh?.trim() || ''
            : isUsableEnglishTranslation(profile?.descriptionEn)
              ? profile.descriptionEn
              : '';
        const tagline = isChinese
            ? profile?.taglineZh?.trim() || ''
            : isUsableEnglishTranslation(profile?.taglineEn)
              ? profile.taglineEn
              : '';

        const logoUrl = profile?.logoAsset ? this.assetUrl(ctx.req, profile.logoAsset) : null;
        const logoOnLightUrl = profile?.logoOnLightAsset
            ? this.assetUrl(ctx.req, profile.logoOnLightAsset)
            : null;
        const logoOnDarkUrl = profile?.logoOnDarkAsset
            ? this.assetUrl(ctx.req, profile.logoOnDarkAsset)
            : null;

        return {
            accessMode: await this.activation.getAccessMode(ctx),
            logoAssetId: profile?.logoAssetId ?? null,
            logoOnLightAssetId: profile?.logoOnLightAssetId ?? null,
            logoOnDarkAssetId: profile?.logoOnDarkAssetId ?? null,
            logoUrl,
            logoOnLightUrl,
            logoOnDarkUrl,
            name,
            description,
            tagline,
            backgroundColor: profile?.brandBackgroundColor ?? null,
            primaryColor: profile?.brandPrimaryColor ?? null,
            accentColor: profile?.brandAccentColor ?? null,
            highlightColor: profile?.brandHighlightColor ?? null,
            legalEntityName: profile?.legalEntityName ?? null,
            legalRegistrationCountry: profile?.legalRegistrationCountry ?? null,
            legalRegistrationNumber: profile?.legalRegistrationNumber ?? null,
            legalContactAddress: profile?.legalContactAddress ?? null,
            supportEmail: profile?.supportEmail ?? null,
            privacyEmail: profile?.privacyEmail ?? null,
        };
    }

    private assetUrl(req: Request | undefined, asset: Asset): string {
        return this.mediaUrl(
            req,
            asset.mimeType === 'image/svg+xml' ? asset.source : asset.preview || asset.source,
        );
    }

    private mediaUrl(req: Request | undefined, identifier: string): string {
        const normalized = identifier.trim();
        if (!normalized) return '';
        if (/^(?:https?:|data:image\/)/i.test(normalized)) return normalized;
        const storageStrategy = this.configService.assetOptions.assetStorageStrategy;
        if (req && storageStrategy.toAbsoluteUrl) {
            return storageStrategy.toAbsoluteUrl(req, normalized.replace(/^\/assets\//, ''));
        }
        return normalized.startsWith('/') ? normalized : `/assets/${normalized}`;
    }
}

@Resolver()
export class StorefrontBrandingAdminResolver {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private activation: StorefrontActivationService,
        @Optional() private readonly publicCache?: StorefrontPublicCacheService,
    ) {}

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async refreshStorefrontPublicCache(@Ctx() ctx: RequestContext) {
        if (ctx.apiType !== 'admin' || !ctx.activeUserId || !ctx.userHasPermissions([Permission.SuperAdmin]))
            throw new ForbiddenError();
        if (!this.publicCache) throw new Error('Public cache service unavailable');
        const before = await this.publicCache.revision(ctx.channelId);
        await this.publicCache.invalidate(ctx.channelId);
        const revision = await this.publicCache.revision(ctx.channelId);
        if (!revision || revision === before) throw new Error('Public cache revision did not advance');
        return {
            channelId: String(ctx.channelId),
            processId: process.pid,
            shared: this.publicCache.sharedVersions,
            revisionFingerprint: createHash('sha256').update(revision).digest('hex'),
        };
    }

    @Query()
    @Allow(storefrontContentPermission.Read)
    async storefrontPreviewBranding(@Ctx() ctx: RequestContext) {
        const branding = await new StorefrontBrandingShopResolver(
            this.connection,
            this.configService,
            this.activation,
        ).loadBranding(ctx);
        return { channelId: String(ctx.channelId), ...branding };
    }
}
