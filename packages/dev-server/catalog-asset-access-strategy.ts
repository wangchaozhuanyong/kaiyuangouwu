import {
    type GetImageTransformParametersArgs,
    type ImageTransformStrategy,
    PresetOnlyStrategy,
} from '@vendure/asset-server-plugin';
import { ConfigService, extractSessionToken, Injector, SessionService } from '@vendure/core';
import {
    StorefrontMediaDeliveryService,
    StorefrontMediaManifestService,
    StorefrontPromotionAccessService,
} from '@vendure/store-management-plugin';

export const PUBLIC_CATALOG_ASSET_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, must-revalidate';
export const PUBLIC_CATALOG_ASSET_AUTHORIZATION_TTL_MS = 30_000;

class StorefrontIconPresetStrategy extends PresetOnlyStrategy {
    private readonly pngStrategy = new PresetOnlyStrategy({
        defaultPreset: 'storefront-original-preview',
        permittedQuality: [75, 82, 90],
        permittedFormats: ['png'],
    });

    override getImageTransformParameters(args: GetImageTransformParametersArgs) {
        const iconPreset =
            args.input.preset === 'storefront-icon-96' ||
            args.input.preset === 'storefront-thumbnail-fit-320';
        return iconPreset && args.input.format === 'png'
            ? this.pngStrategy.getImageTransformParameters(args)
            : super.getImageTransformParameters(args);
    }
}

export function createCatalogImageTransformStrategies(
    bootstrapBaseSchema: boolean,
): ImageTransformStrategy[] {
    return [
        ...(!bootstrapBaseSchema ? [new CatalogAssetAccessStrategy()] : []),
        new StorefrontIconPresetStrategy({
            defaultPreset: 'storefront-original-preview',
            permittedQuality: [75, 82, 90],
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
        let sessionRequest: ReturnType<SessionService['getSessionFromToken']> | undefined;
        const getSession = () => {
            if (!extracted || extracted.method === 'api-key') return Promise.resolve(undefined);
            sessionRequest ??= this.injector.get(SessionService).getSessionFromToken(extracted.token);
            return sessionRequest;
        };
        const request = await this.injector.get(StorefrontPromotionAccessService).resolveRequest(req);
        if (!request) {
            if ((await getSession())?.user?.id) return input;
            throw new Error('Asset access denied');
        }
        let identifier: string;
        try {
            identifier = decodeURIComponent(req.path).replace(/^\/(?:assets\/)?/, '');
        } catch {
            throw new Error('Asset access denied');
        }
        const allowPublicImage = async () => {
            // Authorization is channel-scoped and shared caches key by origin/host. A short public
            // lifetime therefore reuses the same published variant without crossing stores.
            // If exact-purge tracking is configured but unavailable, serve the image privately.
            // This avoids adding an untracked shared-cache entry during an outage.
            const tracked = await this.injector
                .get(StorefrontMediaDeliveryService)
                .record(request.ctx.channelId, request.host, req.originalUrl ?? `/assets/${identifier}`);
            if (tracked) req.res?.setHeader('Cache-Control', PUBLIC_CATALOG_ASSET_CACHE_CONTROL);
            return input;
        };
        try {
            if (
                await this.injector
                    .get(StorefrontMediaManifestService)
                    .isPublic(request.ctx, request.host, identifier)
            )
                return allowPublicImage();
        } catch (error) {
            // Preserve existing authenticated media access if a public lookup is unavailable.
            if (!(await getSession())?.user?.id) throw error;
        }
        if ((await getSession())?.user?.id) return input;
        throw new Error('Asset access denied');
    }
}
