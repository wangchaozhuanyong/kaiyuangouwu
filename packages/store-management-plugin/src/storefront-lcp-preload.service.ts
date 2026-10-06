import { Injectable } from '@nestjs/common';
import { ID, RequestContext } from '@vendure/core';
import {
    mediaDescriptor,
    serializeStorefrontPageData,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    storefrontIcon,
} from '@vendure/storefront-content-plugin';

import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { StorefrontPublicPageService } from './storefront-public-page.service';

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
    const media = mediaDescriptor(source, 'hero');
    const attributes = ['rel="preload"', 'as="image"', `href="${escapeHtmlAttribute(media.src)}"`];
    if (media.srcSet) {
        attributes.push('type="image/webp"');
        attributes.push(`imagesrcset="${escapeHtmlAttribute(media.srcSet)}"`);
        attributes.push(`imagesizes="${escapeHtmlAttribute(media.sizes ?? '')}"`);
    }
    attributes.push('fetchpriority="high"');
    return `<link ${attributes.join(' ')} />`;
}

@Injectable()
export class StorefrontLcpPreloadService {
    constructor(
        private readonly pages: StorefrontPublicPageService,
        private readonly cache: StorefrontPublicCacheService,
    ) {}

    async render(ctx: RequestContext, host: string): Promise<string> {
        // SSI has a 500ms upstream budget: a cache miss must not start database assembly.
        const page = await this.pages.peek(ctx, host);
        if (!page) return '';
        const config = page.config as { logoUrl?: string | null };
        const content = page.content as
            { blocks?: Array<{ type: string; enabled?: boolean; imageUrl?: string }> } | undefined;
        const firstHero = content?.blocks?.find(
            block => block.type === 'HERO' && block.enabled !== false && block.imageUrl,
        );
        const identity = firstHero?.imageUrl
            ? mediaDescriptor(firstHero.imageUrl, 'hero').identity
            : undefined;
        const hero = identity && page.media.find(item => item.kind === 'hero' && item.identity === identity);
        return [
            renderStorefrontIconLinks(config.logoUrl ?? null),
            hero ? renderHeroPreloadLink(hero.identity) : '',
            `<script id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}" type="application/json">${serializeStorefrontPageData(page)}</script>`,
        ]
            .filter(Boolean)
            .join('\n');
    }

    invalidate(channelId: ID): Promise<void> {
        return this.cache.invalidate(channelId);
    }
}
