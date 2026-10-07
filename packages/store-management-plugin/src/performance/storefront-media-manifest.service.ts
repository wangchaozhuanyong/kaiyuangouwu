import { Injectable } from '@nestjs/common';
import {
    Collection,
    LanguageCode,
    Product,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontContentService, type StorefrontImageKind } from '@vendure/storefront-content-plugin';

import { promotionAssetPaths } from '../promotion/promotion-public-assets';
import { StorefrontPromotionService } from '../promotion/storefront-promotion.service';

import { StorefrontPublicCacheService } from './storefront-public-cache.service';
import { PUBLIC_MEDIA_USES, publicContentImageKinds, publicHeroMobileImage } from './storefront-public-media';

export const STOREFRONT_MEDIA_MANIFEST_TTL_MS = 30_000;
const MAX_CATALOG_ROWS = 20_000;
interface CatalogAssetRow {
    featuredPreview?: string;
    featuredSource?: string;
    preview?: string;
    source?: string;
}

export interface StorefrontMediaManifest {
    channelId: string;
    host: string;
    paths: string[];
    uses: Array<{ path: string; kind: StorefrontImageKind }>;
}

@Injectable()
export class StorefrontMediaManifestService {
    constructor(
        private readonly cache: StorefrontPublicCacheService,
        private readonly connection: TransactionalConnection,
        private readonly content: StorefrontContentService,
        private readonly promotion: StorefrontPromotionService,
    ) {}

    async isPublic(ctx: RequestContext, host: string, path: string): Promise<boolean> {
        // Generated cache files and private asset stores never become public by filename inference.
        if (!/^(?:preview|source)\//u.test(path) || path.split('/').some(part => part === '..')) return false;
        const manifest = await this.get(ctx, host);
        return manifest.paths.includes(path);
    }

    get(ctx: RequestContext, host: string): Promise<StorefrontMediaManifest> {
        return this.cache.readThrough(
            ctx,
            `media-manifest:${host}`,
            STOREFRONT_MEDIA_MANIFEST_TTL_MS,
            () => this.build(ctx, host),
            { requireSharedRevision: true },
        );
    }

    peek(ctx: RequestContext, host: string): Promise<StorefrontMediaManifest | undefined> {
        return this.cache.peek(ctx, `media-manifest:${host}`);
    }

    private async build(ctx: RequestContext, host: string): Promise<StorefrontMediaManifest> {
        const origin = new URL(`https://${host}`).origin;
        const [blocks, html, products, variants, collections] = await Promise.all([
            this.content.findPublished(ctx, false, LanguageCode.zh_Hans),
            this.promotion.renderPublished(ctx, ''),
            this.catalogPaths(ctx, Product),
            this.catalogPaths(ctx, ProductVariant),
            this.catalogPaths(ctx, Collection),
        ]);
        const paths = new Set<string>();
        const uses = new Map<string, { path: string; kind: StorefrontImageKind }>();
        const use = (path: string | null | undefined, kind: StorefrontImageKind) => {
            if (path && /^(?:preview|source)\//u.test(path)) uses.set(`${path}:${kind}`, { path, kind });
        };
        const add = (path: string | null | undefined) => {
            if (path && /^(?:preview|source)\//u.test(path) && !path.split('/').includes('..'))
                paths.add(path);
        };
        for (const block of blocks) {
            const mobileImageUrl = publicHeroMobileImage(block, origin);
            for (const image of [
                block,
                ...block.items,
                ...(mobileImageUrl ? [{ imageUrl: mobileImageUrl }] : []),
            ]) {
                if (!image.imageUrl) continue;
                try {
                    const url = new URL(image.imageUrl, origin);
                    if (url.origin === origin && url.pathname.startsWith('/assets/')) {
                        const path = decodeURIComponent(url.pathname.slice('/assets/'.length));
                        add(path);
                        for (const kind of publicContentImageKinds(
                            block.type,
                            image === block || image.imageUrl === mobileImageUrl ? 'block' : 'item',
                        ))
                            use(path, kind);
                    }
                } catch {
                    /* Invalid published URLs grant no access. */
                }
            }
        }
        for (const path of promotionAssetPaths(html, origin)) add(path);
        for (const row of [...products, ...variants, ...collections]) {
            add(row.featuredPreview);
            add(row.featuredSource);
            add(row.preview);
            add(row.source);
        }
        for (const row of [...products, ...variants]) {
            for (const path of [row.featuredPreview, row.preview]) {
                for (const kind of [...PUBLIC_MEDIA_USES.productList, ...PUBLIC_MEDIA_USES.productDetail])
                    use(path, kind);
            }
        }
        for (const row of collections) {
            for (const kind of PUBLIC_MEDIA_USES.collection) use(row.featuredPreview, kind);
        }
        return {
            channelId: String(ctx.channelId),
            host,
            paths: [...paths].sort(),
            uses: [...uses.values()].filter(item => paths.has(item.path)),
        };
    }

    private async catalogPaths(
        ctx: RequestContext,
        entity: typeof Product | typeof ProductVariant | typeof Collection,
    ): Promise<CatalogAssetRow[]> {
        const query = this.connection
            .getRepository(ctx, entity)
            .createQueryBuilder('item')
            .innerJoin('item.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .leftJoin('item.featuredAsset', 'featured')
            .leftJoin('item.assets', 'orderedAsset')
            .leftJoin('orderedAsset.asset', 'asset')
            .select('featured.preview', 'featuredPreview')
            .addSelect('featured.source', 'featuredSource')
            .addSelect('asset.preview', 'preview')
            .addSelect('asset.source', 'source')
            .distinct(true)
            .limit(MAX_CATALOG_ROWS + 1);
        if (entity === Collection) query.andWhere('item.isPrivate = :isPrivate', { isPrivate: false });
        else query.andWhere('item.enabled = :enabled AND item.deletedAt IS NULL', { enabled: true });
        if (entity === ProductVariant) {
            query
                .innerJoin(
                    'item.product',
                    'product',
                    'product.enabled = :enabled AND product.deletedAt IS NULL',
                    { enabled: true },
                )
                .innerJoin('product.channels', 'productChannel', 'productChannel.id = :channelId', {
                    channelId: ctx.channelId,
                });
        }
        const rows = await query.getRawMany<CatalogAssetRow>();
        if (rows.length > MAX_CATALOG_ROWS)
            throw new Error('Public media manifest exceeds its bounded catalog size');
        return rows;
    }
}
