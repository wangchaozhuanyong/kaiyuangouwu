import { Query, Resolver } from '@nestjs/graphql';
import type { Asset } from '@vendure/core';
import {
    Allow,
    ConfigService,
    Ctx,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
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
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId: ctx.channelId },
            relations: { logoAsset: true },
        });

        const customFields = ctx.channel.customFields as StorefrontChannelFields;
        const isChinese = String(ctx.languageCode).toLowerCase().startsWith('zh');
        const name =
            (isChinese ? customFields.storefrontNameZh : customFields.storefrontNameEn) ||
            customFields.storefrontNameZh ||
            customFields.storefrontNameEn ||
            ctx.channel.code;
        const description =
            (isChinese ? profile?.descriptionZh : profile?.descriptionEn) ||
            profile?.descriptionZh ||
            profile?.descriptionEn ||
            '';

        let logoUrl = null;
        if (profile?.logoAsset) {
            logoUrl = this.assetUrl(ctx.req, profile.logoAsset);
        }

        return {
            logoUrl,
            name,
            description,
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
