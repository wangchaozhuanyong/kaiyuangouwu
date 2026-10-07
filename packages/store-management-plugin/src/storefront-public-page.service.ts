import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SortOrder } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
    ConfigService,
    CountryService,
    ProvinceService,
    PUBLIC_PRODUCT_SUMMARY_READER,
    RequestContext,
    TransactionalConnection,
    type PublicProductSummaryReader,
} from '@vendure/core';
import type { PublicPageRequest, StorefrontPageData } from '@vendure/storefront-content-plugin';
import {
    canonicalPublicPageRequest,
    isReusablePublicPageData,
    publicPageRequestKey,
    publicPageRouteHref,
    StorefrontAccountSettingsService,
    StorefrontAuthSettingsService,
    StorefrontContentService,
    StorefrontVisualPresetService,
    type StorefrontContentBlock,
} from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';

import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { publicPageMedia } from './performance/storefront-public-media';
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
    ) {}

    private key(host: string, request: PublicPageRequest) {
        return `page:v2:${host}:${publicPageRequestKey(request)}`;
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

    read(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest = { kind: 'home' },
        options: { refresh?: boolean } = {},
    ): Promise<StorefrontPageData> {
        if (ctx.activeUserId || ctx.session || ctx.apiType !== 'shop')
            throw new Error('Public page requires anonymous Shop context');
        request = canonicalPublicPageRequest(request);
        return this.readAuthorized(ctx, host, request, options);
    }

    private async readAuthorized(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest,
        options: { refresh?: boolean },
    ): Promise<StorefrontPageData> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const mode = await this.getAccessMode(ctx);
            if (mode === 'CLOSED') throw new StorefrontClosedError();
            // Concurrent section completions share only a currently executing authority lookup.
            // Clear it immediately: cache hits, later phases and delayed sections must query again.
            let guardInFlight: Promise<void> | undefined;
            const assertReusable = () => {
                if (!guardInFlight)
                    guardInFlight = this.assertMode(ctx, 'LIVE').finally(() => {
                        guardInFlight = undefined;
                    });
                return guardInFlight;
            };
            const load = async (): Promise<StorefrontPageData> => {
                const routeData = this.cache.trackSource(() =>
                    request.kind === 'catalog'
                        ? this.moduleRef
                              .get<PublicCatalogReader>(PUBLIC_CATALOG_READER, { strict: false })
                              .find(ctx, request.input)
                              .then(catalog => ({ route: '/category', catalog }))
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
                const [common, data] = await Promise.all([
                    this.assemble(ctx, host, request.kind === 'home', mode),
                    routeData,
                ]);
                const combined = {
                    ...common,
                    config: { ...(common.config as object), accessMode: mode },
                    ...data,
                    route: publicPageRouteHref(request),
                    request,
                    requestKey: publicPageRequestKey(request),
                };
                const content = combined.content as { blocks?: Array<{ type?: string }> } | undefined;
                const navigationContent = content
                    ? {
                          ...content,
                          blocks: content.blocks?.filter(block =>
                              ['NAVIGATION', 'CORE_CATEGORIES', 'QUICK_LINKS'].includes(block.type ?? ''),
                          ),
                      }
                    : undefined;
                const page = {
                    ...combined,
                    media: publicPageMedia(
                        request.kind === 'home' ? combined : { ...combined, content: navigationContent },
                    ),
                };
                return {
                    ...page,
                    version: createHash('sha256').update(JSON.stringify(page)).digest('hex').slice(0, 24),
                };
            };
            try {
                const page =
                    mode === 'PREVIEW'
                        ? await this.cache.runUncached(load)
                        : await this.cache.runGuarded(assertReusable, async () => {
                              let result = await this.cache.readThrough(
                                  ctx,
                                  this.key(host, request),
                                  PAGE_TTL,
                                  load,
                                  options,
                              );
                              if (!isReusablePublicPageData(result)) {
                                  // Snapshots created before access metadata existed must never be reusable.
                                  await this.cache.invalidate(ctx.channelId);
                                  result = await this.cache.readThrough(
                                      ctx,
                                      this.key(host, request),
                                      PAGE_TTL,
                                      load,
                                      { refresh: true },
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

    private async assemble(
        ctx: RequestContext,
        host: string,
        home: boolean,
        mode: 'LIVE' | 'PREVIEW',
    ): Promise<StorefrontPageData> {
        const section = <T>(key: string, ttl: number, load: () => Promise<T>) =>
            mode === 'PREVIEW' ? this.cache.loadUncached(load) : this.cache.readThrough(ctx, key, ttl, load);
        // Optional sections fail independently. No failed response is converted to an empty success.
        const configPromise = section(`config:${host}`, 60_000, () => this.loadConfig(ctx));
        const [config, sections] = await Promise.all([
            configPromise,
            Promise.allSettled(
                [
                    section(`content:${host}`, 60_000, () => this.loadContent(ctx)),
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
                ].map(promise => publicSectionWithinBudget<unknown>(promise)),
            ),
        ]);
        const names = ['content', 'products', 'collections', 'visualPreset', 'flashSales'] as const;
        const values: Record<string, unknown> = {};
        const failures: StorefrontPageData['failures'] = [];
        sections.forEach((result, index) => {
            if (result.status === 'fulfilled') values[names[index]] = result.value;
            else failures.push(names[index]);
        });
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
