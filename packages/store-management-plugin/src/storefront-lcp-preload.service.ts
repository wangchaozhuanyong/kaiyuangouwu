import { Injectable, Optional } from '@nestjs/common';
import { ID, RequestContext } from '@vendure/core';
import {
    isReusablePublicPageData,
    mediaDescriptor,
    serializeStorefrontPageData,
    STOREFRONT_IMAGE_SIZES,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    storefrontIcon,
    storefrontNavigationCollections,
    type MediaDescriptor,
    type PublicNavigationCollection,
    type PublicPageRequest,
} from '@vendure/storefront-content-plugin';

import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { publicHeroMobileImage } from './performance/storefront-public-media';
import { StorefrontPublicPageWarmService } from './storefront-public-page-warm.service';
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
    return renderMediaPreloadLink(mediaDescriptor(source, 'hero'));
}

export function renderMediaPreloadLink(media: MediaDescriptor, condition?: string): string {
    const attributes = ['rel="preload"', 'as="image"', `href="${escapeHtmlAttribute(media.src)}"`];
    if (media.srcSet) {
        attributes.push('type="image/webp"');
        attributes.push(`imagesrcset="${escapeHtmlAttribute(media.srcSet)}"`);
        attributes.push(`imagesizes="${escapeHtmlAttribute(media.sizes ?? '')}"`);
    }
    attributes.push('fetchpriority="high"');
    if (condition) attributes.push(`media="${escapeHtmlAttribute(condition)}"`);
    return `<link ${attributes.join(' ')} />`;
}

@Injectable()
export class StorefrontLcpPreloadService {
    constructor(
        private readonly pages: StorefrontPublicPageService,
        private readonly cache: StorefrontPublicCacheService,
        @Optional() private readonly warmer?: StorefrontPublicPageWarmService,
    ) {}

    async render(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest = { kind: 'home' },
        layout?: { primaryCollectionId: string },
    ): Promise<string> {
        // SSI has a 500ms upstream budget: a cache miss must not start database assembly.
        const page = await this.pages.peek(ctx, host, request);
        void this.warmer?.observe(ctx, host, request).catch(() => undefined);
        if (!page || !isReusablePublicPageData(page)) return '';
        const config = page.config as { logoUrl?: string | null };
        const content = page.content as
            | {
                  blocks?: Array<{
                      type: string;
                      enabled?: boolean;
                      imageUrl?: string;
                      settings?: Record<string, unknown> | null;
                  }>;
              }
            | undefined;
        const firstHero = content?.blocks?.find(
            block => block.type === 'HERO' && block.enabled !== false && block.imageUrl,
        );
        const identity = firstHero?.imageUrl
            ? mediaDescriptor(firstHero.imageUrl, 'hero').identity
            : undefined;
        const hero = identity && page.media.find(item => item.kind === 'hero' && item.identity === identity);
        const mobileSource = publicHeroMobileImage(firstHero, `https://${host}`);
        const mobileIdentity = mobileSource ? mediaDescriptor(mobileSource, 'hero').identity : undefined;
        const mobileHero =
            mobileIdentity &&
            mobileIdentity !== identity &&
            page.media.find(item => item.kind === 'hero' && item.identity === mobileIdentity);
        const product = (request.kind === 'product' ? page.product : page.catalog?.items[0]) as
            | {
                  featuredAsset?: { preview?: string };
                  variants?: Array<{ featuredAsset?: { preview?: string } }>;
              }
            | undefined;
        const source =
            product?.featuredAsset?.preview ??
            product?.variants?.find(variant => variant.featuredAsset?.preview)?.featuredAsset?.preview;
        const navigation = storefrontNavigationCollections(
            (page.collections ?? []) as PublicNavigationCollection[],
        );
        const primary =
            layout?.primaryCollectionId !== 'all'
                ? navigation.find(collection => collection.id === layout?.primaryCollectionId)
                : undefined;
        const hasSidebar =
            request.kind === 'catalog' && request.path !== '/search' && (primary?.children?.length ?? 0) > 0;
        const mobileCatalogSizes = hasSidebar
            ? STOREFRONT_IMAGE_SIZES.categorySidebarRow
            : STOREFRONT_IMAGE_SIZES.productRow;
        const kind = request.kind === 'product' ? 'detail' : 'card';
        const routeMedia = source
            ? mediaDescriptor(
                  source,
                  kind,
                  request.kind === 'catalog'
                      ? { sizes: STOREFRONT_IMAGE_SIZES.desktopCatalogCard }
                      : undefined,
              )
            : undefined;
        // Legacy /storefront aliases are mapped to hashed WebP files by the browser build.
        // The API cannot guess that build's candidate; avoid a second, mismatched request.
        const sharedCandidate = (media: MediaDescriptor) =>
            Boolean(media.srcSet) || !media.identity.includes('/storefront/');
        const desktopHeroMedia = hero ? mediaDescriptor(hero.identity, 'hero') : undefined;
        const mobileHeroMedia = mobileHero ? mediaDescriptor(mobileHero.identity, 'hero') : undefined;
        const homePreload = [
            mobileHeroMedia && sharedCandidate(mobileHeroMedia)
                ? renderMediaPreloadLink(mobileHeroMedia, '(max-width: 767px)')
                : '',
            desktopHeroMedia && sharedCandidate(desktopHeroMedia)
                ? renderMediaPreloadLink(desktopHeroMedia, mobileHeroMedia ? '(min-width: 768px)' : undefined)
                : '',
        ]
            .filter(Boolean)
            .join('\n');
        const preload =
            request.kind === 'home'
                ? homePreload
                : routeMedia && source && sharedCandidate(routeMedia)
                  ? request.kind === 'catalog'
                      ? [
                            renderMediaPreloadLink(
                                mediaDescriptor(source, 'card', { sizes: mobileCatalogSizes }),
                                '(max-width: 1023px)',
                            ),
                            renderMediaPreloadLink(routeMedia, '(min-width: 1024px)'),
                        ].join('\n')
                      : renderMediaPreloadLink(routeMedia)
                  : '';
        return [
            renderStorefrontIconLinks(config.logoUrl ?? null),
            preload,
            `<script id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}" type="application/json">${serializeStorefrontPageData(page)}</script>`,
        ]
            .filter(Boolean)
            .join('\n');
    }

    invalidate(channelId: ID): Promise<void> {
        return this.cache.invalidate(channelId);
    }
}
