import { Injectable, Optional } from '@nestjs/common';
import { ID, RequestContext } from '@vendure/core';
import {
    isReusablePublicPageData,
    mediaDescriptor,
    primaryStorefrontMedia,
    serializeStorefrontBootData,
    serializeStorefrontPageData,
    STOREFRONT_BOOT_DATA_ELEMENT_ID,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    storefrontIcon,
    type MediaDescriptor,
    type PrimaryStorefrontMediaInput,
    type PrimaryStorefrontMediaRoute,
    type PublicNavigationCollection,
    type PublicPageRequest,
} from '@vendure/storefront-content-plugin';

import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { publicHeroMobileImage, publicMediaAssetIdentity } from './performance/storefront-public-media';
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

    async renderBoot(
        ctx: RequestContext,
        host: string,
        authRoute?: 'login' | 'register' | 'forgot-password',
    ): Promise<string> {
        const boot = authRoute
            ? await this.pages.peekBoot(ctx, host, authRoute)
            : await this.pages.peekBoot(ctx, host);
        void this.warmer?.observe(ctx, host, { kind: 'home' }).catch(() => undefined);
        if (!boot) return '';
        const config = boot.config as { logoUrl?: string | null };
        // Worker-prepared public hints only: SSI never assembles content or converts storage assets.
        const preload = authRoute
            ? (boot.media ?? [])
                  .filter(media => media.srcSet || !media.identity.includes('/storefront/'))
                  .map(media => renderMediaPreloadLink(media, '(min-width: 1024px)'))
                  .join('\n')
            : '';
        return [
            renderStorefrontIconLinks(config.logoUrl ?? null),
            preload,
            `<script id="${STOREFRONT_BOOT_DATA_ELEMENT_ID}" type="application/json">${serializeStorefrontBootData(boot)}</script>`,
        ].join('\n');
    }

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
        const route =
            request.kind === 'page'
                ? request.id === 'services' || request.id === 'support'
                    ? request.id
                    : undefined
                : request.kind === 'article'
                  ? undefined
                  : request.kind;
        const preload = route ? this.preloads(page, host, route, layout, request) : '';
        return [
            renderStorefrontIconLinks(config.logoUrl ?? null),
            preload,
            `<script id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}" type="application/json">${serializeStorefrontPageData(page)}</script>`,
        ]
            .filter(Boolean)
            .join('\n');
    }

    private preloads(
        page: Awaited<ReturnType<StorefrontPublicPageService['read']>>,
        host: string,
        route: PrimaryStorefrontMediaRoute,
        layout?: { primaryCollectionId: string },
        request?: PublicPageRequest,
    ) {
        const matches = (candidate: MediaDescriptor) =>
            page.media.some(item => {
                const identity = publicMediaAssetIdentity(candidate, host);
                return identity
                    ? identity.key === publicMediaAssetIdentity(item, host)?.key
                    : candidate.identity === item.identity;
            });
        const content = page.content as { blocks?: PrimaryStorefrontMediaInput['blocks'] } | undefined;
        const blocks = content?.blocks?.map(block => {
            const phone = publicHeroMobileImage(block, `https://${host}`);
            return {
                ...block,
                settings: {
                    ...block.settings,
                    mobileImageUrl: phone && matches(mediaDescriptor(phone, 'hero')) ? phone : undefined,
                },
            };
        });
        return primaryStorefrontMedia({
            route,
            blocks,
            product: page.product as PrimaryStorefrontMediaInput['product'],
            catalogItems: page.catalog?.items as PrimaryStorefrontMediaInput['catalogItems'],
            collections: page.collections as PublicNavigationCollection[] | undefined,
            primaryCollectionId: layout?.primaryCollectionId,
            catalogPath: request?.kind === 'catalog' ? request.path : undefined,
        })
            .flatMap(candidate => {
                const descriptor = mediaDescriptor(candidate.source, candidate.kind, {
                    sizes: candidate.sizes,
                });
                if (
                    (route !== 'product' && route !== 'catalog' && !matches(descriptor)) ||
                    (!descriptor.srcSet && descriptor.identity.includes('/storefront/'))
                )
                    return [];
                return [renderMediaPreloadLink(descriptor, candidate.media)];
            })
            .join('\n');
    }

    invalidate(channelId: ID): Promise<void> {
        return this.cache.invalidate(channelId);
    }
}
