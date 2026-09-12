import {
    type GetImageTransformParametersArgs,
    type ImageTransformStrategy,
    PresetOnlyStrategy,
} from '@vendure/asset-server-plugin';
import { ConfigService, extractSessionToken, Injector, SessionService } from '@vendure/core';
import {
    promotionAssetPaths,
    StorefrontPromotionAccessService,
    StorefrontPromotionService,
} from '@vendure/store-management-plugin';

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
        const html = await this.injector.get(StorefrontPromotionService).renderPublished(request.ctx, '');
        const paths = promotionAssetPaths(html, `https://${request.host}`);
        let identifier: string;
        try {
            identifier = decodeURIComponent(req.path).replace(/^\/(?:assets\/)?/, '');
        } catch {
            throw new Error('Asset access denied');
        }
        if (!paths.has(identifier)) throw new Error('Asset access denied');
        return input;
    }
}
