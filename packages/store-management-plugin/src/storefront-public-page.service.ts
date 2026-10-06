import { Injectable } from '@nestjs/common';
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
import { StorefrontBrandingShopResolver } from './storefront-branding.resolver';
import { StorefrontRegionShopResolver } from './storefront-region.resolver';
import { SystemAnnouncementService } from './system-announcement.service';

const PAGE_TTL = 30_000;
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
    ) {}

    private key(host: string, request: PublicPageRequest) {
        return `page:${host}:${JSON.stringify(request)}`;
    }

    peek(ctx: RequestContext, host: string) {
        return this.cache.peek<StorefrontPageData>(ctx, this.key(host, { kind: 'home' }));
    }

    read(
        ctx: RequestContext,
        host: string,
        request: PublicPageRequest = { kind: 'home' },
    ): Promise<StorefrontPageData> {
        if (ctx.activeUserId || ctx.session || ctx.apiType !== 'shop')
            throw new Error('Public page requires anonymous Shop context');
        return this.cache.readThrough(ctx, this.key(host, request), PAGE_TTL, async () => {
            const routeData =
                request.kind === 'catalog'
                    ? this.moduleRef
                          .get<PublicCatalogReader>(PUBLIC_CATALOG_READER, { strict: false })
                          .find(ctx, request.input)
                          .then(catalog => ({ route: '/category', catalog }))
                    : request.kind === 'product'
                      ? this.moduleRef
                            .get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, { strict: false })
                            .detail(ctx, request.id)
                            .then(product => ({
                                route: `/product/${encodeURIComponent(request.id)}`,
                                product,
                            }))
                      : Promise.resolve({ route: '/' });
            const [common, data] = await Promise.all([
                this.assemble(ctx, host, request.kind === 'home'),
                routeData,
            ]);
            const combined = { ...common, ...data };
            const page = { ...combined, media: publicPageMedia(combined) };
            return {
                ...page,
                version: createHash('sha256').update(JSON.stringify(page)).digest('hex').slice(0, 24),
            };
        });
    }

    private async assemble(ctx: RequestContext, host: string, home: boolean): Promise<StorefrontPageData> {
        // Optional sections fail independently. No failed response is converted to an empty success.
        const configPromise = this.cache.readThrough(ctx, `config:${host}`, 60_000, () =>
            this.loadConfig(ctx),
        );
        const [config, sections] = await Promise.all([
            configPromise,
            Promise.allSettled(
                [
                    this.cache.readThrough(ctx, `content:${host}`, 60_000, () => this.loadContent(ctx)),
                    home
                        ? this.cache.readThrough(ctx, `home-products:${host}`, 30_000, () =>
                              this.moduleRef
                                  .get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, {
                                      strict: false,
                                  })
                                  .list(ctx, { take: 12, sort: 'name-asc' })
                                  .then(page => page.items),
                          )
                        : Promise.resolve(undefined),
                    this.cache.readThrough(ctx, `collections:${host}`, 30_000, () =>
                        this.loadCollections(ctx),
                    ),
                    this.cache.readThrough(ctx, `visual-preset:${host}`, 60_000, () =>
                        this.moduleRef.get(StorefrontVisualPresetService, { strict: false }).get(ctx),
                    ),
                    this.cache.readThrough(ctx, `flash-sales:${host}`, 30_000, () =>
                        this.campaigns.findFlashSales(ctx, true).then(sales =>
                            sales.map(sale => ({
                                id: String(sale.id),
                                startsAt: sale.startsAt,
                                endsAt: sale.endsAt,
                                items: sale.items,
                            })),
                        ),
                    ),
                ].map(section => publicSectionWithinBudget<unknown>(section)),
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
            new StorefrontBrandingShopResolver(this.connection, this.configService).loadBranding(ctx),
            this.countries.findAllAvailable(ctx),
            new StorefrontRegionShopResolver(this.provinces, this.countries).availableStorefrontProvinces(
                ctx,
            ),
            this.currency.getPublic(ctx),
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
                this.content.findPublished(ctx),
                this.content.getSettings(ctx),
                this.auth.get(ctx),
                account.getPersonalDataExportEnabled(ctx),
                account.getRecommendations(ctx),
                this.announcements.findActive(ctx),
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
