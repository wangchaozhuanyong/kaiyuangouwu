import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SortOrder } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
    ConfigService,
    CountryService,
    ProcessContext,
    ProvinceService,
    PUBLIC_PRODUCT_SUMMARY_READER,
    RequestContext,
    TransactionalConnection,
    type PublicProductSummaryReader,
} from '@vendure/core';
import type {
    PublicPageRequest,
    StorefrontBootData,
    StorefrontPageData,
} from '@vendure/storefront-content-plugin';
import {
    canonicalPublicPageRequest,
    effectivePublicCatalogInput,
    isReusablePublicPageData,
    mediaDescriptor,
    primaryStorefrontMedia,
    publicPageRequestKey,
    publicPageRouteHref,
    StorefrontAccountSettingsService,
    StorefrontAuthSettingsService,
    StorefrontContentService,
    StorefrontVisualPresetService,
    validInlineImagePreview,
    type MediaDescriptor,
    type PrimaryStorefrontMediaRoute,
    type PublicNavigationCollection,
    type StorefrontContentBlock,
} from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';

import { measurePublicDocument, recordPublicDocumentCache } from './performance/public-document-timing';
import { StorefrontMediaManifestService } from './performance/storefront-media-manifest.service';
import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import {
    preservePublicMediaPreviews,
    publicMediaAssetIdentity,
    publicMediaPreviewGroups,
    publicMediaWithPreviews,
    publicPageMedia,
} from './performance/storefront-public-media';
import { StorePromotionCampaignService } from './promotion/store-promotion-campaign.service';
import { PUBLIC_CATALOG_READER, type PublicCatalogReader } from './public-catalog-reader';
import { StoreCurrencySettingsService } from './store-currency-settings.service';
import {
    StorefrontActivationService,
    StorefrontClosedError,
    type StorefrontAccessMode,
} from './storefront-activation.service';
import { StorefrontBrandingShopResolver } from './storefront-branding.resolver';
import { StorefrontRegionShopResolver } from './storefront-region.resolver';
import { SystemAnnouncementService } from './system-announcement.service';

const PAGE_TTL = 30_000;
const BOOT_MEDIA_TTL = 60_000;
type AuthMediaRoute = 'login' | 'register' | 'forgot-password';
type PreparedBootMedia = Partial<Record<'login' | 'register', MediaDescriptor>>;
class PublicPageAccessChangedError extends Error {}
const publicFields = <T extends object, K extends keyof T>(value: T, keys: readonly K[]) =>
    Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<T, K>;

/** Optional data has a finite assembly budget; a timeout remains missing, never an empty success. */
export async function publicSectionWithinBudget<T>(promise: Promise<T>, budgetMs = 600): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Public section deferred')), budgetMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** The shared assembly path for cached SSI and public client reads. Business writes remain elsewhere. */
@Injectable()
export class StorefrontPublicPageService {
    private readonly observedModes = new Map<string, StorefrontAccessMode>();
    private readonly invalidating = new Map<string, Promise<void>>();
    constructor(
        private readonly cache: StorefrontPublicCacheService,
        private readonly moduleRef: ModuleRef,
        private readonly content: StorefrontContentService,
        private readonly auth: StorefrontAuthSettingsService,
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
        private readonly countries: CountryService,
        private readonly provinces: ProvinceService,
        private readonly collections: CollectionService,
        private readonly currency: StoreCurrencySettingsService,
        private readonly campaigns: StorePromotionCampaignService,
        private readonly announcements: SystemAnnouncementService,
        private readonly activation: StorefrontActivationService,
        @Optional() private readonly processContext?: ProcessContext,
    ) {}

    private key(host: string, request: PublicPageRequest) {
        // v2 default-category snapshots contain all-store results. Do not adopt
        // that payload under the corrected effective query when a runtime changes.
        return `page:v3:${host}:${publicPageRequestKey(request)}`;
    }

    /** Do not cache this decision: a reused context must see a committed status/domain change. */
    async getAccessMode(ctx: RequestContext): Promise<StorefrontAccessMode> {
        const mode = await this.activation.getAccessMode(ctx);
        const channel = String(ctx.channelId);
        if (mode !== 'LIVE' && this.observedModes.get(channel) !== mode) {
            let invalidating = this.invalidating.get(channel);
            if (!invalidating) {
                invalidating = this.cache
                    .invalidate(ctx.channelId)
                    .catch(error => {
                        // The cache already marks shared revisions unavailable and rotates on recovery.
                        // Closure still returns 403 and preview still uses bounded, uncached origin reads.
                        if (!(error instanceof ServiceUnavailableException)) throw error;
                    })
                    .finally(() => {
                        this.invalidating.delete(channel);
                    });
                this.invalidating.set(channel, invalidating);
            }
            await invalidating;
        }
        if (!this.observedModes.has(channel) && this.observedModes.size >= 256) {
            const oldest = this.observedModes.keys().next().value;
            if (oldest !== undefined) this.observedModes.delete(oldest);
        }
        this.observedModes.set(channel, mode);
        return mode;
    }

    private async assertMode(ctx: RequestContext, expected: 'LIVE' | 'PREVIEW'): Promise<void> {
        const mode = await this.getAccessMode(ctx);
        if (mode === 'CLOSED') throw new StorefrontClosedError();
        if (mode !== expected) throw new PublicPageAccessChangedError('Public access changed during read');
    }

    async peek(ctx: RequestContext, host: string, request: PublicPageRequest = { kind: 'home' }) {
        if (ctx.activeUserId || ctx.session || ctx.apiType !== 'shop') return undefined;
        const mode = await this.getAccessMode(ctx);
        if (mode === 'CLOSED') throw new StorefrontClosedError();
        if (mode !== 'LIVE') return undefined;
        try {
            const page = await this.cache.runGuarded(
                () => this.assertMode(ctx, 'LIVE'),
                () => this.cache.peek<StorefrontPageData>(ctx, this.key(host, request)),
            );
            if (!page) {
                // A miss has no cached value to version-check; closure must still be explicit.
                if ((await this.getAccessMode(ctx)) === 'CLOSED') throw new StorefrontClosedError();
            }
            return isReusablePublicPageData(page) ? page : undefined;
        } catch (error) {
            if (error instanceof PublicPageAccessChangedError) return undefined;
            throw error;
        }
    }

    /** SSI may use warm configuration for private routes without assembling public catalog data. */
    async peekBoot(
        ctx: RequestContext,
        host: string,
        authRoute?: AuthMediaRoute,
    ): Promise<StorefrontBootData | undefined> {
        if (ctx.activeUserId || ctx.session || ctx.apiType !== 'shop') return;
        if ((await this.getAccessMode(ctx)) !== 'LIVE') return;
        try {
            return await this.cache.runGuarded(
                () => this.assertMode(ctx, 'LIVE'),
                async () => {
                    const [config, visual, preparedMedia] = await Promise.all([
                        this.cache.peekEntry<Record<string, unknown>>(ctx, `config:${host}`),
                        this.cache.peekEntry<{ presetId: string }>(ctx, `visual-preset:${host}`),
                        authRoute
                            ? this.cache.peekEntry<PreparedBootMedia>(ctx, `boot-media:${host}`)
                            : undefined,
                    ]);
                    if (
                        !config ||
                        config.value.code !== ctx.channel.code ||
                        (visual && visual.revision !== config.revision) ||
                        config.revision !== (await this.cache.revision(ctx.channelId))
                    )
                        return;
                    const media =
                        preparedMedia?.revision === config.revision && authRoute
                            ? preparedMedia.value?.[authRoute === 'register' ? 'register' : 'login']
                            : undefined;
                    return {
                        schemaVersion: 1,
                        generatedAt: Date.now(),
                        configUpdatedAt: config.expiresAt - 60_000,
                        scope: {
                            host,
                            channelCode: String(config.value.code),
                            languageCode: ctx.languageCode,
                            currencyCode: ctx.currencyCode,
                            priceContext: 'public',
                        },
                        config: { ...config.value, accessMode: 'LIVE' },
                        ...(visual
                            ? { visualPreset: visual.value, visualUpdatedAt: visual.expiresAt - 60_000 }
                            : {}),
                        ...(media && preparedMedia
                            ? { media: [media], mediaUpdatedAt: preparedMedia.expiresAt - BOOT_MEDIA_TTL }
                            : {}),
                    };
                },
            );
        } catch (error) {
            if (error instanceof PublicPageAccessChangedError) return;
            throw error;
        }
    }

    /** Called by the background cache owner, using content warmed under the same revision. */
    async prepareBootMedia(ctx: RequestContext, host: string): Promise<void> {
        if (
            ctx.activeUserId ||
            ctx.session ||
            ctx.apiType !== 'shop' ||
            (await this.getAccessMode(ctx)) !== 'LIVE'
        )
            return;
        const providers = this.previewProviders();
        if (!providers) return;
        await this.cache.runGuarded(
            () => this.assertMode(ctx, 'LIVE'),
            async () => {
                const previous = await this.cache.peek<PreparedBootMedia>(ctx, `boot-media:${host}`);
                await this.cache.readThrough(
                    ctx,
                    `boot-media:${host}`,
                    BOOT_MEDIA_TTL,
                    async () => {
                        const content = await this.cache.peekEntry<{ blocks?: StorefrontContentBlock[] }>(
                            ctx,
                            `content:${host}`,
                        );
                        if (!content || content.revision !== (await this.cache.revision(ctx.channelId)))
                            return undefined;
                        const routes = ['login', 'register'] as const;
                        const entries = routes.flatMap(route =>
                            primaryStorefrontMedia({ route, blocks: content.value.blocks }).map(
                                candidate => ({
                                    route,
                                    descriptor: mediaDescriptor(candidate.source, candidate.kind, {
                                        sizes: candidate.sizes,
                                    }),
                                }),
                            ),
                        );
                        const media = await publicMediaWithPreviews(
                            entries.map(entry => entry.descriptor),
                            host,
                            path => providers.manifest.isPublic(ctx, host, path),
                            path => providers.reader.readPublicInlinePreview(path),
                        );
                        return Object.fromEntries(entries.map((entry, index) => [entry.route, media[index]]));
                    },
                    {
                        requireSharedRevision: true,
                        refresh: !previous || Object.values(previous).some(item => !item?.placeholder),
                    },
                );
            },
        );
    }

    read(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest = { kind: 'home' },
        options: { refresh?: boolean; prepareMedia?: boolean; prepareCoupons?: boolean } = {},
        onResolvedRevision?: (revision: string | undefined) => void,
    ): Promise<StorefrontPageData> {
        if (ctx.activeUserId || ctx.session || ctx.apiType !== 'shop')
            throw new Error('Public page requires anonymous Shop context');
        request = canonicalPublicPageRequest(request);
        return this.readAuthorized(ctx, host, request, options, onResolvedRevision);
    }

    /** Complete this document's first-screen artwork without extending API or worker reads. */
    async readForDocument(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest = { kind: 'home' },
    ): Promise<StorefrontPageData> {
        if (ctx.activeUserId || ctx.session || ctx.apiType !== 'shop')
            throw new Error('Public page requires anonymous Shop context');
        const identity = () =>
            JSON.stringify([host, ctx.channelId, ctx.channel.code, ctx.languageCode, ctx.currencyCode]);
        const scope = identity();
        const mode = await measurePublicDocument('page-access', () => this.getAccessMode(ctx));
        if (mode === 'CLOSED') throw new StorefrontClosedError();
        // Preview and shared-cache outages retain their existing anonymous short-read path.
        if (mode !== 'LIVE') return measurePublicDocument('page-read', () => this.read(ctx, host, request));
        let revision = await measurePublicDocument('page-revision', () => this.cache.revision(ctx.channelId));
        if (!revision) return measurePublicDocument('page-read', () => this.read(ctx, host, request));
        // The existing guarded read can legitimately retry into a newer generation.
        // Bind additional document work to its validated result, not a pre-read token.
        const page = await measurePublicDocument('page-read', () =>
            this.read(ctx, host, request, {}, resolved => {
                revision = resolved;
            }),
        );
        const assertCurrent = () =>
            measurePublicDocument('page-document-check', async () => {
                try {
                    await this.assertMode(ctx, mode);
                } catch (error) {
                    if (!(error instanceof PublicPageAccessChangedError)) throw error;
                    throw new ServiceUnavailableException('Public access changed; retry the document');
                }
                if (
                    !revision ||
                    identity() !== scope ||
                    page.scope.host !== host ||
                    page.scope.channelCode !== ctx.channel.code ||
                    page.scope.languageCode !== String(ctx.languageCode) ||
                    page.scope.currencyCode !== String(ctx.currencyCode) ||
                    revision !== (await this.cache.revision(ctx.channelId))
                )
                    throw new ServiceUnavailableException('Public page changed; retry the document');
            });
        await assertCurrent();
        const deadline = Date.now() + 500;
        const media = await measurePublicDocument('page-document-media', () =>
            this.publicMedia(ctx, host, page, false, new Set(), new Set(), undefined, {
                existing: page.media,
                deadline,
                run: (load, fallback) =>
                    publicSectionWithinBudget(
                        this.cache.runGuarded(assertCurrent, () =>
                            this.cache.readThrough(
                                ctx,
                                `document-media:${host}:${publicPageRequestKey(canonicalPublicPageRequest(request))}:${page.version}`,
                                1,
                                () => (Date.now() >= deadline ? Promise.resolve(fallback) : load()),
                                { shouldCache: () => false },
                            ),
                        ),
                        Math.max(0, deadline - Date.now()),
                    ).catch(() => fallback),
            }),
        );
        await assertCurrent();
        if (media === page.media) return page;
        const { version: _, ...payload } = page;
        const complete = { ...payload, media };
        return {
            ...complete,
            version: createHash('sha256').update(JSON.stringify(complete)).digest('hex').slice(0, 24),
        };
    }

    private async readAuthorized(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest,
        options: { refresh?: boolean; prepareMedia?: boolean; prepareCoupons?: boolean },
        onResolvedRevision?: (revision: string | undefined) => void,
    ): Promise<StorefrontPageData> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const mode = await this.getAccessMode(ctx);
            if (mode === 'CLOSED') throw new StorefrontClosedError();
            // Concurrent section completions share only a currently executing authority lookup.
            // Clear it immediately: cache hits, later phases and delayed sections must query again.
            let guardInFlight: Promise<void> | undefined;
            const deferredMedia = new WeakSet<StorefrontPageData>();
            const rejectedMediaPages = new WeakSet<StorefrontPageData>();
            const mediaAuthorizations = new WeakMap<StorefrontPageData, ReadonlySet<string>>();
            const losesMedia = (next: StorefrontPageData, previous: StorefrontPageData) =>
                JSON.stringify(next.scope) === JSON.stringify(previous.scope) &&
                preservePublicMediaPreviews(next.media, previous.media, host).some(
                    (item, index) =>
                        validInlineImagePreview(item.placeholder?.inlineData) &&
                        !validInlineImagePreview(next.media[index]?.placeholder?.inlineData),
                );
            const assertReusable = () => {
                if (!guardInFlight)
                    guardInFlight = this.assertMode(ctx, 'LIVE').finally(() => {
                        guardInFlight = undefined;
                    });
                return guardInFlight;
            };
            const load = async (): Promise<StorefrontPageData> => {
                // Capture per loader invocation: a revision retry must never reuse a prior entry.
                const mediaRevision =
                    mode === 'LIVE' && options.refresh
                        ? this.cache.revision(ctx.channelId)
                        : Promise.resolve(undefined);
                const commonData = this.assemble(
                    ctx,
                    host,
                    request.kind === 'home',
                    mode,
                    options.prepareCoupons === true &&
                        (this.processContext?.isWorker === true || this.cache.sharedVersions === false),
                );
                const routeData = this.cache.trackSource(() =>
                    request.kind === 'catalog'
                        ? (async () => {
                              // Only a default category depends on the published navigation.
                              // Explicit categories and search keep their parallel read path.
                              const collections =
                                  request.path !== '/search' &&
                                  (!request.input.collectionId || request.input.collectionId === 'all')
                                      ? ((await commonData).collections ?? [])
                                      : [];
                              return this.moduleRef
                                  .get<PublicCatalogReader>(PUBLIC_CATALOG_READER, { strict: false })
                                  .find(
                                      ctx,
                                      effectivePublicCatalogInput(
                                          request,
                                          collections as PublicNavigationCollection[],
                                      ),
                                  )
                                  .then(catalog => ({ route: '/category', catalog }));
                          })()
                        : request.kind === 'product'
                          ? this.moduleRef
                                .get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, {
                                    strict: false,
                                })
                                .detail(ctx, request.id)
                                .then(product => ({
                                    route: `/product/${encodeURIComponent(request.id)}`,
                                    product,
                                }))
                          : Promise.resolve({ route: '/' }),
                );
                const [common, data] = await Promise.all([commonData, routeData]);
                const combined = {
                    ...common,
                    config: { ...(common.config as object), accessMode: mode },
                    ...data,
                    route: publicPageRouteHref(request),
                    request,
                    requestKey: publicPageRequestKey(request),
                };
                const authorizedMedia = new Set<string>();
                const rejectedMedia = new Set<string>();
                const mediaPreparation = { deferred: false };
                const [prepared, previous, revision] = await Promise.all([
                    measurePublicDocument('page-loader-media', () =>
                        this.publicMedia(
                            ctx,
                            host,
                            combined,
                            mode === 'LIVE' && options.prepareMedia === true && this.processContext?.isWorker,
                            authorizedMedia,
                            rejectedMedia,
                            mediaPreparation,
                        ),
                    ),
                    mode === 'LIVE' && options.refresh
                        ? this.cache.peekEntry<StorefrontPageData>(ctx, this.key(host, request))
                        : Promise.resolve(undefined),
                    mediaRevision,
                ]);
                // These pixels were manifest-authorized in this exact shared generation.
                // Keep only matching new descriptors, never old content or another scope's media.
                const reusableMedia =
                    revision &&
                    previous?.revision === revision &&
                    JSON.stringify(previous.value.scope) === JSON.stringify(combined.scope);
                const media = reusableMedia
                    ? preservePublicMediaPreviews(
                          prepared,
                          previous.value.media.filter(item =>
                              authorizedMedia.has(publicMediaAssetIdentity(item, host)?.path ?? ''),
                          ),
                          host,
                      )
                    : prepared;
                const page = {
                    ...combined,
                    media,
                };
                const result = {
                    ...page,
                    version: createHash('sha256').update(JSON.stringify(page)).digest('hex').slice(0, 24),
                };
                mediaAuthorizations.set(result, new Set(authorizedMedia));
                if (rejectedMedia.size) rejectedMediaPages.add(result);
                // Preserve the current denial priority: revoked pixels must leave a healthy cache.
                // Otherwise the ordinary 30s page lifetime must not freeze unfinished optional work.
                if (mediaPreparation.deferred && !rejectedMedia.size) deferredMedia.add(result);
                if (
                    reusableMedia &&
                    !rejectedMedia.size &&
                    preservePublicMediaPreviews(prepared, previous.value.media, host).some(
                        (item, index) =>
                            validInlineImagePreview(item.placeholder?.inlineData) &&
                            !validInlineImagePreview(media[index]?.placeholder?.inlineData),
                    )
                )
                    deferredMedia.add(result);
                return result;
            };
            const timedLoad = () => measurePublicDocument('page-loader', load);
            try {
                if (mode === 'PREVIEW') recordPublicDocumentCache('bypass');
                const page =
                    mode === 'PREVIEW'
                        ? await this.cache.runUncached(timedLoad)
                        : await this.cache.runGuarded(assertReusable, async () => {
                              const pageCacheOptions = {
                                  ...options,
                                  onResolvedRevision,
                                  observeRead: recordPublicDocumentCache,
                                  shouldCache: (value: StorefrontPageData, current?: StorefrontPageData) => {
                                      const allowed = mediaAuthorizations.get(value);
                                      if (
                                          current &&
                                          isReusablePublicPageData(current) &&
                                          JSON.stringify(value.scope) === JSON.stringify(current.scope) &&
                                          allowed?.size
                                      ) {
                                          const merged = preservePublicMediaPreviews(
                                              value.media,
                                              current.media.filter(item =>
                                                  allowed.has(
                                                      publicMediaAssetIdentity(item, host)?.path ?? '',
                                                  ),
                                              ),
                                              host,
                                          );
                                          if (
                                              merged.some(
                                                  (item, index) =>
                                                      item.placeholder?.inlineData !==
                                                      value.media[index]?.placeholder?.inlineData,
                                              )
                                          ) {
                                              value.media = merged;
                                              value.version = createHash('sha256')
                                                  .update(
                                                      JSON.stringify(
                                                          Object.fromEntries(
                                                              Object.entries(value).filter(
                                                                  ([key]) => key !== 'version',
                                                              ),
                                                          ),
                                                      ),
                                                  )
                                                  .digest('hex')
                                                  .slice(0, 24);
                                          }
                                      }
                                      return (
                                          !deferredMedia.has(value) &&
                                          (!current ||
                                              !isReusablePublicPageData(current) ||
                                              rejectedMediaPages.has(value) ||
                                              !losesMedia(value, current))
                                      );
                                  },
                                  invalidateOnConflict: (value: StorefrontPageData) =>
                                      rejectedMediaPages.has(value),
                              };
                              let result = await this.cache.readThrough(
                                  ctx,
                                  this.key(host, request),
                                  PAGE_TTL,
                                  timedLoad,
                                  pageCacheOptions,
                              );
                              if (!isReusablePublicPageData(result)) {
                                  // Snapshots created before access metadata existed must never be reusable.
                                  await this.cache.invalidate(ctx.channelId);
                                  result = await this.cache.readThrough(
                                      ctx,
                                      this.key(host, request),
                                      PAGE_TTL,
                                      timedLoad,
                                      { ...pageCacheOptions, refresh: true },
                                  );
                              }
                              return result;
                          });
                // LIVE's final authority check is inside the cache's final revision check.
                // An additional await here would reopen the just-validated generation window.
                if (mode === 'PREVIEW') await this.assertMode(ctx, mode);
                return page;
            } catch (error) {
                if (!(error instanceof PublicPageAccessChangedError)) throw error;
            }
        }
        throw new ServiceUnavailableException('Public access changed; retry the read');
    }

    private async publicMedia(
        ctx: RequestContext,
        host: string,
        page: StorefrontPageData,
        prepare = false,
        authorized = new Set<string>(),
        rejected = new Set<string>(),
        preparation?: { deferred: boolean },
        document?: {
            existing: MediaDescriptor[];
            deadline: number;
            run: (
                load: () => Promise<MediaDescriptor[]>,
                fallback: MediaDescriptor[],
            ) => Promise<MediaDescriptor[]>;
        },
    ) {
        const media = document?.existing ?? publicPageMedia(page);
        if (!media.length) return media;
        const providers = this.previewProviders();
        if (!providers) return media;
        const { reader, manifest } = providers;
        const request = page.request;
        const route: PrimaryStorefrontMediaRoute | undefined =
            request?.kind === 'page'
                ? request.id === 'services' || request.id === 'support'
                    ? request.id
                    : undefined
                : request?.kind === 'home' || request?.kind === 'catalog' || request?.kind === 'product'
                  ? request.kind
                  : undefined;
        const first = route
            ? primaryStorefrontMedia({
                  route,
                  blocks: (page.content as { blocks?: StorefrontContentBlock[] } | undefined)?.blocks,
                  product: page.product as Parameters<typeof primaryStorefrontMedia>[0]['product'],
                  catalogItems: page.catalog?.items as Parameters<
                      typeof primaryStorefrontMedia
                  >[0]['catalogItems'],
                  collections: page.collections as PublicNavigationCollection[] | undefined,
                  catalogPath: request?.kind === 'catalog' ? request.path : undefined,
              })
            : [];
        const priority = new Set(
            first.map(
                candidate =>
                    publicMediaAssetIdentity(mediaDescriptor(candidate.source, candidate.kind), host)?.key,
            ),
        );
        const content = page.content as { blocks?: StorefrontContentBlock[] } | undefined;
        const visible = publicPageMedia({
            ...page,
            content: {
                blocks: content?.blocks?.filter(block => {
                    if (['NAVIGATION', 'CORE_CATEGORIES', 'QUICK_LINKS'].includes(block.type)) return true;
                    if (route === 'home')
                        return !['AUTH_LOGIN', 'AUTH_REGISTER', 'SUPPORT', 'CLIENT_PLUGINS'].includes(
                            block.type,
                        );
                    return (
                        block.type ===
                        (route === 'services' ? 'CLIENT_PLUGINS' : route === 'support' ? 'SUPPORT' : '')
                    );
                }),
            },
            products: route === 'home' ? page.products : undefined,
            bestSellers: route === 'home' ? page.bestSellers : undefined,
            flashSales: route === 'home' ? page.flashSales : undefined,
            catalog: route === 'catalog' ? page.catalog : undefined,
            product: route === 'product' ? page.product : undefined,
        });
        const eligible = new Set(visible.map(item => publicMediaAssetIdentity(item, host)?.key));
        const selected = media.filter(item => eligible.has(publicMediaAssetIdentity(item, host)?.key));
        const ordered = [
            ...selected.filter(item => priority.has(publicMediaAssetIdentity(item, host)?.key)),
            ...selected.filter(item => !priority.has(publicMediaAssetIdentity(item, host)?.key)),
        ];
        const available = new Map<string, string>();
        const documentPaths = new Set<string>();
        const logoUrl = (page.config as { logoUrl?: string | null }).logoUrl;
        if (document) {
            const firstAssets = publicMediaPreviewGroups(ordered, host, logoUrl);
            const versionsByPath = new Map<string, Set<string>>();
            for (const item of ordered) {
                const identity = publicMediaAssetIdentity(item, host);
                if (!identity) continue;
                const versions = versionsByPath.get(identity.path) ?? new Set<string>();
                versions.add(identity.key);
                versionsByPath.set(identity.path, versions);
                if (validInlineImagePreview(item.placeholder?.inlineData))
                    available.set(identity.path, item.placeholder.inlineData);
            }
            if (
                [...firstAssets.values()].every(group =>
                    validInlineImagePreview(ordered[group.indexes[0]]?.placeholder?.inlineData),
                )
            )
                return media;
            for (const group of firstAssets.values()) documentPaths.add(group.path);
            // The path-only derivative reader cannot select between multiple descriptor versions.
            // Never borrow one version's inline pixels for another version of that path.
            for (const [path, versions] of versionsByPath) if (versions.size !== 1) available.delete(path);
        }
        const safeDocumentMedia = (items: MediaDescriptor[]) =>
            items.map(item => {
                const path = publicMediaAssetIdentity(item, host)?.path ?? '';
                return documentPaths.has(path) && !authorized.has(path)
                    ? { ...item, placeholder: undefined }
                    : item;
            });
        const load = async () => {
            // This phase belongs to one page scope/generation, which its owner
            // rechecks before returning or caching. Reuse only this phase's read;
            // a document continuation or publication retry must read afresh.
            let phaseManifest: ReturnType<StorefrontMediaManifestService['get']> | undefined;
            const readManifest = () => (phaseManifest ??= manifest.get(ctx, host));
            const populated = await publicMediaWithPreviews(
                ordered,
                host,
                async path => {
                    try {
                        const allowed = await manifest.isPublic(ctx, host, path, readManifest);
                        (allowed ? authorized : rejected).add(path);
                        return allowed;
                    } catch (error) {
                        rejected.add(path);
                        throw error;
                    }
                },
                path => Promise.resolve(available.get(path) ?? reader.readPublicInlinePreview(path)),
                // Ordinary public/preview reads keep 250ms; only queue-owned workers use 2s.
                // The HTML response has its own bounded continuation; SSI remains cache-only.
                document ? Math.max(0, document.deadline - Date.now()) : prepare ? 2_000 : 250,
                preparation,
                logoUrl,
            );
            const result = [
                ...populated,
                ...media.filter(item => !eligible.has(publicMediaAssetIdentity(item, host)?.key)),
            ];
            // Sanitize inside the phase owner: joined readers receive this same safe result.
            return document ? safeDocumentMedia(result) : result;
        };
        return document ? document.run(load, safeDocumentMedia(media)) : load();
    }

    private previewProviders() {
        // A page descriptor never grants asset access: verify the manifest before local storage reads.
        try {
            const reader = this.moduleRef.get<{
                readPublicInlinePreview(path: string): Promise<string | undefined>;
            }>('STOREFRONT_PUBLIC_IMAGE_PREVIEW', { strict: false });
            const manifest = this.moduleRef.get<StorefrontMediaManifestService>(
                StorefrontMediaManifestService,
                { strict: false },
            );
            if (
                typeof reader?.readPublicInlinePreview === 'function' &&
                typeof manifest?.isPublic === 'function'
            )
                return { reader, manifest };
        } catch {
            /* Optional image metadata never changes public page availability. */
        }
    }

    private async assemble(
        ctx: RequestContext,
        host: string,
        home: boolean,
        mode: 'LIVE' | 'PREVIEW',
        prepareCoupons = false,
    ): Promise<StorefrontPageData> {
        const section = <T>(key: string, ttl: number, load: () => Promise<T>) =>
            mode === 'PREVIEW' ? this.cache.loadUncached(load) : this.cache.readThrough(ctx, key, ttl, load);
        // Optional sections fail independently. No failed response is converted to an empty success.
        const configPromise = measurePublicDocument('page-loader-config', () =>
            section(`config:${host}`, 60_000, () => this.loadConfig(ctx)),
        );
        const contentPromise = measurePublicDocument('page-loader-content', () =>
            section(`content:${host}`, 60_000, () => this.loadContent(ctx)),
        );
        // Ranked data depends on published content, not on the other optional sections.
        // Start its existing budget when that dependency is ready so independent waits overlap.
        const bestSellersPromise = measurePublicDocument('page-loader-best-sellers', () =>
            home
                ? contentPromise.then(
                      content =>
                          content
                              ? publicSectionWithinBudget(
                                    section(`home-best-sellers:${host}`, 30_000, () =>
                                        this.loadHomeBestSellers(ctx, content),
                                    ),
                                )
                              : undefined,
                      // The required content result below owns this failure; no ranked read ran.
                      () => undefined,
                  )
                : Promise.resolve(undefined),
        );
        // Visitors only peek. The explicit internal warm option prepares this slot
        // in the worker or the serving owner of a process-local cache.
        const couponsPromise = home
            ? prepareCoupons
                ? section(`home-coupons:${host}`, 30_000, async () =>
                      (await this.campaigns.findActiveCoupons(ctx)).map(coupon => ({
                          ...publicFields(coupon, [
                              'name',
                              'kind',
                              'appearanceTheme',
                              'startsAt',
                              'endsAt',
                              'claimStartsAt',
                              'claimEndsAt',
                              'validityDays',
                              'minimumSpend',
                              'currencyCode',
                              'discountAmount',
                              'discountRate',
                              'customerEligibility',
                              'remainingIssueCount',
                          ] as const),
                          id: String(coupon.id),
                          claimed: false,
                          claimable: coupon.claimable,
                      })),
                  )
                : this.cache.peek<unknown[]>(ctx, `home-coupons:${host}`)
            : Promise.resolve(undefined);
        let preparedCoupons: unknown[] | undefined;
        if (!prepareCoupons)
            void couponsPromise
                .then(value => {
                    preparedCoupons = value;
                })
                .catch(() => undefined);
        const optionalPhases = [
            'page-loader-products',
            'page-loader-collections',
            'page-loader-visual',
            'page-loader-flash',
        ] as const;
        const [config, sections] = await Promise.all([
            configPromise,
            Promise.allSettled([
                ...[
                    contentPromise,
                    home
                        ? section(`home-products:${host}`, 30_000, () =>
                              this.moduleRef
                                  .get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, {
                                      strict: false,
                                  })
                                  .list(ctx, { take: 12, sort: 'name-asc' })
                                  .then(page => page.items),
                          )
                        : Promise.resolve(undefined),
                    section(`collections:${host}`, 30_000, () => this.loadCollections(ctx)),
                    section(`visual-preset:${host}`, 60_000, () =>
                        this.moduleRef.get(StorefrontVisualPresetService, { strict: false }).get(ctx),
                    ),
                    section(`flash-sales:${host}`, 30_000, () =>
                        this.campaigns.findFlashSales(ctx, true).then(sales =>
                            sales.map(sale => ({
                                id: String(sale.id),
                                startsAt: sale.startsAt,
                                endsAt: sale.endsAt,
                                items: sale.items,
                            })),
                        ),
                    ),
                ].map((promise, index) =>
                    // Published body is required by server-rendered documents. A cold read must
                    // finish before output; only optional recommendations may be deferred.
                    index === 0
                        ? promise
                        : measurePublicDocument(optionalPhases[index - 1], () =>
                              publicSectionWithinBudget<unknown>(promise),
                          ),
                ),
                bestSellersPromise,
                prepareCoupons ? publicSectionWithinBudget(couponsPromise) : Promise.resolve(undefined),
            ]),
        ]);
        const names = [
            'content',
            'products',
            'collections',
            'visualPreset',
            'flashSales',
            'bestSellers',
            'couponCampaigns',
        ] as const;
        const values: Record<string, unknown> = {};
        const failures: StorefrontPageData['failures'] = [];
        sections.forEach((result, index) => {
            if (names[index] === 'bestSellers' && (!home || !values.content)) return;
            if (result.status === 'fulfilled') values[names[index]] = result.value;
            else if (names[index] !== 'couponCampaigns') failures.push(names[index]);
        });
        if (!prepareCoupons && preparedCoupons !== undefined) values.couponCampaigns = preparedCoupons;
        const generatedAt = Date.now();
        const payload = { config, ...values, media: [], failures };
        return {
            schemaVersion: 1,
            version: createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24),
            generatedAt,
            scope: {
                host,
                channelCode: ctx.channel.code,
                languageCode: ctx.languageCode,
                currencyCode: ctx.currencyCode,
                priceContext: 'public',
            },
            route: '/',
            ...payload,
        };
    }

    private async loadConfig(ctx: RequestContext) {
        const [branding, countries, provinces, currency] = await Promise.all([
            this.cache.trackSource(() =>
                new StorefrontBrandingShopResolver(
                    this.connection,
                    this.configService,
                    this.activation,
                ).loadBranding(ctx),
            ),
            this.cache.trackSource(() => this.countries.findAllAvailable(ctx)),
            this.cache.trackSource(() =>
                new StorefrontRegionShopResolver(this.provinces, this.countries).availableStorefrontProvinces(
                    ctx,
                ),
            ),
            this.cache.trackSource(() => this.currency.getPublic(ctx)),
        ]);
        const custom = (ctx.channel.customFields ?? {}) as {
            storefrontNameZh?: string;
            storefrontNameEn?: string;
        };
        return {
            code: ctx.channel.code,
            defaultLanguageCode: ctx.channel.defaultLanguageCode,
            defaultCurrencyCode: ctx.channel.defaultCurrencyCode,
            customFields: {
                storefrontNameZh: custom.storefrontNameZh,
                storefrontNameEn: custom.storefrontNameEn,
            },
            availableCountries: countries.map(country => ({ code: country.code, name: country.name })),
            availableProvinces: provinces,
            ...publicFields(branding, [
                'accessMode',
                'logoUrl',
                'logoOnLightUrl',
                'logoOnDarkUrl',
                'description',
                'tagline',
                'legalEntityName',
                'legalRegistrationCountry',
                'legalRegistrationNumber',
                'legalContactAddress',
                'supportEmail',
                'privacyEmail',
            ]),
            brandBackgroundColor: branding.backgroundColor,
            brandPrimaryColor: branding.primaryColor,
            brandAccentColor: branding.accentColor,
            brandHighlightColor: branding.highlightColor,
            currencyConfiguration: publicFields(currency, [
                'defaultCurrencyCode',
                'availableCurrencyCodes',
                'selectorEnabled',
                'cnyToMyrRate',
                'rateUpdatedAt',
                'usdtDisplayEnabled',
                'usdtMarkupPercent',
                'cnyPerUsdtRate',
                'myrPerUsdtRate',
                'usdtRateSource',
                'usdtRateUpdatedAt',
                'usdtRateAvailable',
                'usdtPaymentConfigured',
            ]),
        };
    }

    private async loadHomeBestSellers(ctx: RequestContext, content: unknown) {
        const published = content as {
            blocks?: Array<{ type?: string; settings?: Record<string, unknown> }>;
            settings?: { configuredBlockTypes?: string[] };
        };
        const block = published.blocks?.find(item => item.type === 'BEST_SELLERS');
        if (!block && published.settings?.configuredBlockTypes?.includes('BEST_SELLERS')) return;
        const configuredCount = block?.settings?.displayCount;
        const count = Math.min(
            50,
            Math.max(
                1,
                typeof configuredCount === 'number' && Number.isFinite(configuredCount) ? configuredCount : 4,
            ),
        );
        const candidateCount = Math.min(48, Math.max(16, count));
        const configuredPinned = block?.settings?.pinnedProductIds;
        const pinnedIds = Array.isArray(configuredPinned)
            ? configuredPinned.flatMap(id => (typeof id === 'string' && id.trim() ? [id.trim()] : []))
            : [];
        const catalogReader = this.moduleRef.get<PublicCatalogReader>(PUBLIC_CATALOG_READER, {
            strict: false,
        });
        const productReader = this.moduleRef.get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, {
            strict: false,
        });
        const [catalog, pinned] = await Promise.all([
            catalogReader.find(ctx, { sort: 'SALES', skip: 0, take: candidateCount }),
            Promise.all([...new Set(pinnedIds)].map(id => productReader.byId(ctx, id))),
        ]);
        const salesByProductId = await catalogReader.sales(
            ctx,
            catalog.items.map(item => item.id),
        );
        return {
            catalog,
            salesByProductId,
            pinnedProducts: pinned.filter(
                (product): product is NonNullable<typeof product> => product !== null,
            ),
            candidateCount,
        };
    }

    private async loadContent(ctx: RequestContext) {
        const account = this.moduleRef.get(StorefrontAccountSettingsService, { strict: false });
        const [blocks, settings, auth, personalDataExportEnabled, accountRecommendations, announcements] =
            await Promise.all([
                this.cache.trackSource(() => this.content.findPublished(ctx)),
                this.cache.trackSource(() => this.content.getSettings(ctx)),
                this.cache.trackSource(() => this.auth.get(ctx)),
                this.cache.trackSource(() => account.getPersonalDataExportEnabled(ctx)),
                this.cache.trackSource(() => account.getRecommendations(ctx)),
                this.cache.trackSource(() => this.announcements.findActive(ctx)),
            ]);
        return {
            blocks: blocks.map(block => this.publicBlock(block)),
            settings: {
                ...settings,
                auth: publicFields(auth, [
                    'emailPasswordEnabled',
                    'emailAutoRegistrationEnabled',
                    'emailQuickRegistrationEnabled',
                    'googleEnabled',
                    'googleClientId',
                ]),
                personalDataExportEnabled,
                accountRecommendations,
            },
            flashSales: [],
            flashSalesDeferred: true,
            systemAnnouncements: announcements.map(item => ({ ...item, id: String(item.id) })),
        };
    }

    private publicBlock(block: StorefrontContentBlock) {
        return {
            ...publicFields(block, [
                'code',
                'type',
                'layoutVariant',
                'enabled',
                'position',
                'startsAt',
                'endsAt',
                'title',
                'subtitle',
                'body',
                'ctaLabel',
                'imageUrl',
                'backgroundColor',
                'textColor',
                'targetType',
                'targetValue',
                'settings',
            ]),
            id: String(block.id),
            imageAsset: block.imageAsset
                ? { width: block.imageAsset.width, height: block.imageAsset.height }
                : null,
            items: block.items.map(item => ({
                ...publicFields(item, [
                    'enabled',
                    'position',
                    'imageUrl',
                    'targetType',
                    'targetValue',
                    'settings',
                    'label',
                    'description',
                ]),
                id: String(item.id),
            })),
        };
    }

    private async loadCollections(ctx: RequestContext) {
        const items: Collection[] = [];
        let skip = 0;
        for (;;) {
            const page = await this.collections.findAll(
                ctx,
                { take: 100, skip, filter: { isPrivate: { eq: false } }, sort: { position: SortOrder.ASC } },
                ['featuredAsset', 'parent'],
            );
            items.push(...page.items);
            skip += page.items.length;
            if (!page.items.length || skip >= page.totalItems) break;
        }
        const counts = await this.collections.getProductVariantCounts(
            ctx,
            items.map(item => item.id),
        );
        const project = (item: Collection) => ({
            id: String(item.id),
            name: item.name,
            slug: item.slug,
            description: item.description,
            position: item.position,
            parentId: String(item.parentId),
            productVariantCount: counts.get(String(item.id)) ?? 0,
            featuredAsset: item.featuredAsset
                ? { id: String(item.featuredAsset.id), preview: item.featuredAsset.preview }
                : null,
        });
        const byParent = new Map<string, Collection[]>();
        for (const item of items) {
            const parent = String(item.parentId);
            const children = byParent.get(parent) ?? [];
            children.push(item);
            byParent.set(parent, children);
        }
        return items
            .filter(item => item.parent?.isRoot)
            .map(item => ({
                ...project(item),
                children: (byParent.get(String(item.id)) ?? []).map(project),
            }));
    }
}
