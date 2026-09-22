import { Injectable } from '@nestjs/common';
import { CacheService, ID, RequestContext } from '@vendure/core';
import {
    normalizeStorefrontAssetUrl,
    responsiveImageSources,
    StorefrontContentService,
} from '@vendure/storefront-content-plugin';

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
    ) {}

    async render(ctx: RequestContext): Promise<string> {
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
