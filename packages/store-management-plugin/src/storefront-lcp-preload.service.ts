import { Injectable } from '@nestjs/common';
import { CacheService, ConfigService, ID, RequestContext, TransactionalConnection } from '@vendure/core';
import {
    normalizeStorefrontAssetUrl,
    responsiveImageSources,
    StorefrontContentService,
    storefrontIcon,
} from '@vendure/storefront-content-plugin';

import { StorefrontBrandingShopResolver } from './storefront-branding.resolver';

const PRELOAD_CACHE_TTL_MS = 5 * 60 * 1000;

function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/"/gu, '&quot;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;');
}

export function storefrontContentCacheTag(channelId: ID): string {
    return `StorefrontLcpPreload:channel:${String(channelId)}`;
}

export function renderStorefrontIconLinks(source: string | null): string {
    return (['icon', 'apple-touch-icon'] as const)
        .map(rel => {
            const icon = storefrontIcon(source, rel);
            const type = icon.type ? ` type="${icon.type}"` : '';
            return `<link rel="${rel}" href="${escapeHtmlAttribute(icon.href)}"${type} data-storefront-icon="server" />`;
        })
        .join('\n');
}

export function renderHeroPreloadLink(source: string): string {
    const normalized = normalizeStorefrontAssetUrl(source);
    const responsive = responsiveImageSources(normalized, 'hero');
    const attributes = [
        'rel="preload"',
        'as="image"',
        `href="${escapeHtmlAttribute(responsive?.fallbackSrc ?? normalized)}"`,
    ];
    if (responsive) {
        attributes.push('type="image/webp"');
        attributes.push(`imagesrcset="${escapeHtmlAttribute(responsive.webpSrcSet)}"`);
        attributes.push(`imagesizes="${escapeHtmlAttribute(responsive.sizes)}"`);
    }
    attributes.push('fetchpriority="high"');
    return `<link ${attributes.join(' ')} />`;
}

@Injectable()
export class StorefrontLcpPreloadService {
    constructor(
        private readonly cacheService: CacheService,
        private readonly contentService: StorefrontContentService,
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
    ) {}

    async render(ctx: RequestContext): Promise<string> {
        const [hero, branding] = await Promise.all([
            this.renderHero(ctx),
            new StorefrontBrandingShopResolver(this.connection, this.configService).loadBranding(ctx),
        ]);
        // Brand edits must not wait for the independent, cached hero preload.
        return `${renderStorefrontIconLinks(branding.logoUrl)}\n${hero}`;
    }

    private async renderHero(ctx: RequestContext): Promise<string> {
        const cacheKey = `StorefrontLcpPreload:${String(ctx.channelId)}:${String(ctx.languageCode)}`;
        const cached = await this.cacheService.get<string>(cacheKey);
        if (cached !== undefined) return cached;

        const blocks = await this.contentService.findPublished(ctx);
        const source = blocks
            .find(block => block.type === 'HERO' && block.imageUrl?.trim())
            ?.imageUrl?.trim();
        const html = source ? renderHeroPreloadLink(source) : '';
        await this.cacheService.set(cacheKey, html, {
            ttl: PRELOAD_CACHE_TTL_MS,
            tags: [storefrontContentCacheTag(ctx.channelId)],
        });
        return html;
    }

    invalidate(channelId: ID): Promise<void> {
        return this.cacheService.invalidateTags([storefrontContentCacheTag(channelId)]);
    }
}
