import {
    type GetImageTransformParametersArgs,
    type ImageTransformStrategy,
    PresetOnlyStrategy,
} from '@vendure/asset-server-plugin';
import {
    AdministratorService,
    Asset,
    ConfigService,
    CustomerService,
    extractSessionToken,
    Injector,
    Permission,
    RequestContext,
    SessionService,
    TransactionalConnection,
} from '@vendure/core';
import {
    AdministratorAccessService,
    StorefrontMediaDeliveryService,
    StorefrontMediaManifestService,
    StorefrontPromotionAccessService,
} from '@vendure/store-management-plugin';
import { AdminTwoFactorService } from '@vendure/two-factor-dashboard-plugin';

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
        let identifier: string;
        try {
            identifier = decodeURIComponent(req.path).replace(/^\/(?:assets\/)?/, '');
        } catch {
            throw new Error('Asset access denied');
        }
        if (
            !/^(?:source|preview)\//u.test(identifier) ||
            identifier.includes('\\') ||
            identifier.includes('\0') ||
            identifier.split('/').some(part => part === '..' || part === '.')
        )
            throw new Error('Asset access denied');
        const request = await this.injector.get(StorefrontPromotionAccessService).resolveRequest(req);
        const allowPublicImage = async (ctx: RequestContext, host: string) => {
            // Authorization is channel-scoped and shared caches key by origin/host. A short public
            // lifetime therefore reuses the same published variant without crossing stores.
            // If exact-purge tracking is configured but unavailable, serve the image privately.
            // This avoids adding an untracked shared-cache entry during an outage.
            const tracked = await this.injector
                .get(StorefrontMediaDeliveryService)
                .record(ctx.channelId, host, req.originalUrl ?? `/assets/${identifier}`);
            if (tracked) req.res?.setHeader('Cache-Control', PUBLIC_CATALOG_ASSET_CACHE_CONTROL);
            return input;
        };
        if (request) {
            if (
                await this.injector
                    .get(StorefrontMediaManifestService)
                    .isPublic(request.ctx, request.host, identifier)
            )
                return allowPublicImage(request.ctx, request.host);
        }
        const session = await getSession();
        if (!session?.user?.id) throw new Error('Asset access denied');
        const asset = await this.injector
            .get(TransactionalConnection)
            .rawConnection.getRepository(Asset)
            .findOne({
                where: [{ source: identifier }, { preview: identifier }],
                relations: ['channels', 'tags'],
            });
        if (!asset) throw new Error('Asset access denied');
        const isAvatar = asset.tags.some(tag => tag.value === 'customer-avatar');

        // A known filename and a customer session grant no catalog access. Private avatars
        // retain their existing owner + channel boundary, including unpublished originals.
        if (request && asset.channels.some(channel => String(channel.id) === String(request.ctx.channelId))) {
            const customer = await this.injector
                .get(CustomerService)
                .findOneByUserId(request.ctx, session.user.id);
            if (
                customer &&
                isAvatar &&
                asset.tags.some(tag => tag.value === `customer-avatar-owner:${String(customer.id)}`)
            )
                return input;
        }

        // Admin media uses the same role, store suspension and 2FA checks as the API.
        // The asset's own channels bound central-console reads when no storefront host exists.
        for (const channel of asset.channels) {
            if (request && String(channel.id) !== String(request.ctx.channelId)) continue;
            const ctx = new RequestContext({
                req,
                apiType: 'admin',
                channel,
                session,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });
            const permissions = isAvatar
                ? [Permission.ReadAsset, Permission.SuperAdmin]
                : [Permission.ReadCatalog, Permission.ReadAsset, Permission.SuperAdmin];
            if (!ctx.userHasPermissions(permissions)) continue;
            const administrator = await this.injector
                .get(AdministratorService)
                .findOneByUserId(ctx, session.user.id);
            if (!administrator) continue;
            await this.injector.get(AdministratorAccessService).currentForChannel(ctx);
            await this.injector.get(AdminTwoFactorService).assertSession(ctx);
            return input;
        }
        throw new Error('Asset access denied');
    }
}
