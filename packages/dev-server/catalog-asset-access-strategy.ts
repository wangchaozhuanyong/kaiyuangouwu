import {
    type GetImageTransformParametersArgs,
    type ImageTransformStrategy,
    PresetOnlyStrategy,
} from '@vendure/asset-server-plugin';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Collection,
    ConfigService,
    extractSessionToken,
    Injector,
    Product,
    ProductVariant,
    type RequestContext,
    SessionService,
    TransactionalConnection,
} from '@vendure/core';
import {
    promotionAssetPaths,
    StorefrontPromotionAccessService,
    StorefrontPromotionService,
} from '@vendure/store-management-plugin';
import { StorefrontContentService } from '@vendure/storefront-content-plugin';
import { IsNull } from 'typeorm';

export function createCatalogImageTransformStrategies(
    bootstrapBaseSchema: boolean,
): ImageTransformStrategy[] {
    return [
        ...(!bootstrapBaseSchema ? [new CatalogAssetAccessStrategy()] : []),
        new PresetOnlyStrategy({
            defaultPreset: 'storefront-original-preview',
            permittedQuality: [75, 90],
            permittedFormats: ['webp'],
        }),
    ];
}

// Reuse the asset server's existing pre-read strategy hook. The same check runs
// before originals, previews and transformed cache files can be returned.
export class CatalogAssetAccessStrategy implements ImageTransformStrategy {
    private injector: Injector;

    init(injector: Injector) {
        this.injector = injector;
    }

    async getImageTransformParameters({ req, input }: GetImageTransformParametersArgs) {
        req.res?.setHeader('Cache-Control', 'private, no-store');
        req.res?.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        const config = this.injector.get(ConfigService);
        const extracted = extractSessionToken(
            req,
            config.authOptions.tokenMethod,
            config.authOptions.apiKeyHeaderKey,
        );
        const session =
            extracted && extracted.method !== 'api-key'
                ? await this.injector.get(SessionService).getSessionFromToken(extracted.token)
                : undefined;
        const request = await this.injector.get(StorefrontPromotionAccessService).resolveRequest(req);
        if (!request) {
            if (session?.user?.id) return input;
            throw new Error('Asset access denied');
        }
        let identifier: string;
        try {
            identifier = decodeURIComponent(req.path).replace(/^\/(?:assets\/)?/, '');
        } catch {
            throw new Error('Asset access denied');
        }
        const origin = `https://${request.host}`;
        const allowPublicImage = () => {
            // Keep a browser copy across refreshes; shared caches must not cross stores.
            req.res?.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
            return input;
        };
        try {
            const blocks = await this.injector
                .get(StorefrontContentService)
                .findPublished(request.ctx, false, LanguageCode.zh_Hans);
            // Only the exact image URLs emitted by published store content are public.
            // Images are shared between translations. Check source-language publication so
            // an English browser header cannot hide a visual on a published Chinese page.
            for (const block of blocks) {
                for (const image of [block, ...block.items]) {
                    if (!image.imageUrl) continue;
                    try {
                        const url = new URL(image.imageUrl, origin);
                        if (
                            url.origin === origin &&
                            url.pathname.startsWith('/assets/') &&
                            decodeURIComponent(url.pathname).slice('/assets/'.length) === identifier
                        )
                            return allowPublicImage();
                    } catch {
                        /* Invalid URLs do not grant access. */
                    }
                }
            }
            const html = await this.injector.get(StorefrontPromotionService).renderPublished(request.ctx, '');
            const paths = promotionAssetPaths(html, origin);
            if (paths.has(identifier) || (await this.isPublishedCatalogImage(request.ctx, identifier))) {
                return allowPublicImage();
            }
        } catch (error) {
            // Preserve existing authenticated media access if a public lookup is unavailable.
            if (!session?.user?.id) throw error;
        }
        if (session?.user?.id) return input;
        throw new Error('Asset access denied');
    }

    private async isPublishedCatalogImage(ctx: RequestContext, identifier: string): Promise<boolean> {
        if (!/^(?:preview|source)\//u.test(identifier)) return false;
        const connection = this.injector.get(TransactionalConnection);
        const imagePaths = [{ preview: identifier }, { source: identifier }];
        const productScope = { enabled: true, deletedAt: IsNull(), channels: { id: ctx.channelId } };
        const [product, variant, collection] = await Promise.all([
            connection.getRepository(ctx, Product).findOne({
                select: { id: true },
                where: imagePaths.flatMap(asset => [
                    { ...productScope, featuredAsset: asset },
                    { ...productScope, assets: { asset } },
                ]),
            }),
            connection.getRepository(ctx, ProductVariant).findOne({
                select: { id: true },
                where: imagePaths.flatMap(asset => [
                    { ...productScope, product: productScope, featuredAsset: asset },
                    { ...productScope, product: productScope, assets: { asset } },
                ]),
            }),
            connection.getRepository(ctx, Collection).findOne({
                select: { id: true },
                where: imagePaths.flatMap(asset => [
                    { isPrivate: false, channels: { id: ctx.channelId }, featuredAsset: asset },
                    { isPrivate: false, channels: { id: ctx.channelId }, assets: { asset } },
                ]),
            }),
        ]);
        return Boolean(product || variant || collection);
    }
}
