import { Query, Resolver } from '@nestjs/graphql';
import { isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import type { Asset } from '@vendure/core';
import {
    Allow,
    ConfigService,
    Ctx,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { Request } from 'express';

import { StoreProfile } from './entities/store-profile.entity';

interface StorefrontChannelFields {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
}

@Resolver()
export class StorefrontBrandingShopResolver {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
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
        const name = isChinese
            ? customFields.storefrontNameZh || customFields.storefrontNameEn || ctx.channel.code
            : isUsableEnglishTranslation(customFields.storefrontNameEn)
              ? customFields.storefrontNameEn
              : ctx.channel.code;
        const description = isChinese
            ? profile?.descriptionZh || profile?.descriptionEn || ''
            : isUsableEnglishTranslation(profile?.descriptionEn)
              ? profile.descriptionEn
              : '';
        const tagline = isChinese
            ? profile?.taglineZh || profile?.taglineEn || ''
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
    ) {}

    @Query()
    @Allow(storefrontContentPermission.Read)
    async storefrontPreviewBranding(@Ctx() ctx: RequestContext) {
        const branding = await new StorefrontBrandingShopResolver(
            this.connection,
            this.configService,
        ).loadBranding(ctx);
        return { channelId: String(ctx.channelId), ...branding };
    }
}
