import {
    type GetImageTransformParametersArgs,
    type ImageTransformStrategy,
    PresetOnlyStrategy,
} from '@vendure/asset-server-plugin';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ConfigService, extractSessionToken, Injector, SessionService } from '@vendure/core';
import {
    promotionAssetPaths,
    StorefrontPromotionAccessService,
    StorefrontPromotionService,
} from '@vendure/store-management-plugin';
import { StorefrontContentService } from '@vendure/storefront-content-plugin';

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
        if (session?.user?.id) return input;
        const request = await this.injector.get(StorefrontPromotionAccessService).resolveRequest(req);
        if (!request) throw new Error('Asset access denied');
        let identifier: string;
        try {
            identifier = decodeURIComponent(req.path).replace(/^\/(?:assets\/)?/, '');
        } catch {
            throw new Error('Asset access denied');
        }
        const origin = `https://${request.host}`;
        const blocks = await this.injector
            .get(StorefrontContentService)
            .findPublished(request.ctx, true, LanguageCode.zh_Hans);
        // Only the exact image URLs emitted by published account content are public.
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
                        return input;
                } catch {
                    /* Invalid URLs do not grant access. */
                }
            }
        }
        const html = await this.injector.get(StorefrontPromotionService).renderPublished(request.ctx, '');
        const paths = promotionAssetPaths(html, origin);
        if (!paths.has(identifier)) throw new Error('Asset access denied');
        return input;
    }
}
