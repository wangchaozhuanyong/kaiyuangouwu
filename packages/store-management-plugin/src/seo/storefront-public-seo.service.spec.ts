import 'reflect-metadata';

import { ServiceUnavailableException } from '@nestjs/common';
import {
    CurrencyCode,
    LanguageCode,
    Product,
    type PublicProductDetail,
    type RequestContext,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import type { PublicPageRequest, StorefrontPageData } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';
import type { StoreCommerceConfiguration } from '../types';

import { StoreProfile } from '../entities/store-profile.entity';

import { StorefrontPublicSeoService, type StorefrontPublicSeoInitial } from './storefront-public-seo.service';
import { defaultStorefrontSeoSettings, publicStorefrontSeoSettings } from './storefront-seo.contract';

function fixture(languageCode = LanguageCode.en, commerce?: Partial<StoreCommerceConfiguration>) {
    const host = 'synthetic-store.invalid';
    const ctx = {
        channelId: 'synthetic-channel',
        channel: { code: 'synthetic-store' },
        languageCode,
        currencyCode: CurrencyCode.MYR,
    } as RequestContext;
    const configuration = {
        payload: publicStorefrontSeoSettings({
            ...defaultStorefrontSeoSettings(),
            indexingEnabled: true,
            enabledLanguages: ['en'],
        }),
        version: 1,
        publishedAt: new Date('2026-10-21T00:00:00Z'),
    };
    const seo = {
        publishedConfiguration: vi.fn().mockResolvedValue(configuration),
        publishedRecord: vi.fn().mockResolvedValue(null),
    };
    const domains = { findOne: vi.fn().mockResolvedValue({ domain: host }) };
    const profile = { descriptionEn: 'Published description', descriptionZh: '' };
    const profiles = { findOne: vi.fn().mockResolvedValue(profile) };
    const products = {
        findOne: vi.fn().mockResolvedValue({
            channels: [{ id: ctx.channelId }],
            translations: [{ languageCode: LanguageCode.en, name: 'Bed', description: 'Solid wood bed.' }],
        }),
    };
    const connection = {
        getRepository: vi.fn((_ctx: RequestContext, entity: unknown) => {
            if (entity === StoreDomain) return domains;
            if (entity === StoreProfile) return profiles;
            if (entity === Product) return products;
            throw new Error('Unexpected repository');
        }),
    };
    const pages = { getAccessMode: vi.fn().mockResolvedValue('LIVE') };
    const content = { findPublished: vi.fn().mockResolvedValue([]) };
    const sharing = { publicShareMetadata: vi.fn().mockResolvedValue(undefined) };
    const reviews = {
        findApprovedForProduct: vi.fn().mockResolvedValue({ totalItems: 0, averageRating: 0, items: [] }),
    };
    const service = new StorefrontPublicSeoService(
        seo as never,
        connection as never,
        pages as never,
        content as never,
        { get: () => reviews } as never,
        sharing as never,
        commerce ? ({ get: vi.fn().mockResolvedValue(commerce) } as never) : undefined,
    );
    const page = {
        schemaVersion: 1,
        version: 'fixture',
        generatedAt: 1,
        scope: {
            host,
            channelCode: ctx.channel.code,
            languageCode: ctx.languageCode,
            currencyCode: ctx.currencyCode,
            priceContext: 'public',
        },
        request: { kind: 'home' },
        route: '/',
        failures: [],
        media: [],
        config: {
            accessMode: 'LIVE',
            customFields: { storefrontNameEn: 'Published store' },
            description: 'Published description',
            logoUrl: null,
        },
        content: { blocks: [{ type: 'HERO', title: 'Published heading' }] },
    } as StorefrontPageData;
    return {
        service,
        host,
        ctx,
        configuration,
        profile,
        seo,
        domains,
        profiles,
        pages,
        content,
        page,
        sharing,
        reviews,
    };
}

function productFixture({
    sku = 'FC-BED_01',
    quoteOnly = false,
    currencyCode = CurrencyCode.MYR,
    productFields = {},
    variantFields = {},
    autoCardAvailableStock,
    commerce,
}: {
    sku?: string;
    quoteOnly?: boolean;
    currencyCode?: CurrencyCode;
    productFields?: Partial<PublicProductDetail['customFields']>;
    variantFields?: Partial<PublicProductDetail['variants'][number]['customFields']>;
    autoCardAvailableStock?: number;
    commerce?: Partial<StoreCommerceConfiguration>;
} = {}) {
    const test = fixture(LanguageCode.en, commerce);
    test.page.request = { kind: 'product', id: 'fixture-bed' };
    test.page.product = {
        id: 'fixture-bed',
        name: 'Bed',
        description: 'Solid wood bed.',
        featuredAsset: { preview: '/assets/bed.webp' },
        customFields: { pricingMode: quoteOnly ? 'QUOTE_ONLY' : null, ...productFields },
        variants: [
            {
                id: 'fixture-variant',
                sku,
                priceWithTax: 12500,
                currencyCode,
                customFields: variantFields,
                saleableStockLevel: 2,
                autoCardAvailableStock,
            },
        ],
    };
    return test;
}

describe('public Product structured data', () => {
    it.each(['FC-BED_01', '床'.repeat(50)])('retains eligible SKU %s with its real offer', async sku => {
        const test = productFixture({ sku });
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);

        expect(seo?.structuredData.find(item => item['@type'] === 'Product')).toMatchObject({
            sku,
            offers: {
                '@type': 'Offer',
                price: '125.00',
                priceCurrency: 'MYR',
                availability: 'https://schema.org/InStock',
                url: `https://${test.host}/en/product?id=fixture-bed`,
            },
        });
    });

    it.each(['', 'WS 2102-WHITE', 'FC\u00a0BED', 'FC\n', 'FC\u200bBED', 'A'.repeat(51)])(
        'omits incompatible SKU %j without removing its offer or changing the catalog value',
        async sku => {
            const test = productFixture({ sku });
            const result = await test.service.enrich(test.ctx, test.host, test.page);
            const product = result.seo?.structuredData.find(item => item['@type'] === 'Product');

            expect(product).toHaveProperty('offers.price', '125.00');
            expect(product).not.toHaveProperty('sku');
            expect(result.product).toHaveProperty('variants.0.sku', sku);
        },
    );

    it.each([{ quoteOnly: true }, { currencyCode: CurrencyCode.USD }])(
        'omits incomplete Product markup and keeps the page discoverable for %j',
        async options => {
            const test = productFixture(options);
            const { seo } = await test.service.enrich(test.ctx, test.host, test.page);

            expect(seo?.indexable).toBe(true);
            expect(seo?.structuredData.map(item => item['@type'])).not.toContain('Product');
            expect(seo?.structuredData.map(item => item['@type'])).toContain('BreadcrumbList');
        },
    );

    it('retains a product snippet supported by genuine public ratings on an inquiry page', async () => {
        const test = productFixture({ quoteOnly: true });
        test.reviews.findApprovedForProduct.mockResolvedValue({
            totalItems: 1,
            averageRating: 4,
            items: [{ anonymous: true }],
        });
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        const product = seo?.structuredData.find(item => item['@type'] === 'Product');

        expect(product).toHaveProperty('aggregateRating.ratingValue', 4);
        expect(product).toHaveProperty('aggregateRating.reviewCount', 1);
        expect(product).not.toHaveProperty('offers');
    });

    it('uses immediate delivery and the configured non-refundable policy for an automatic digital product', async () => {
        const test = productFixture({
            sku: 'AI-TOPUP-100',
            productFields: { refundPolicy: 'NON_REFUNDABLE' },
            variantFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
            autoCardAvailableStock: 5,
            commerce: { countryCode: 'MY' },
        });

        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        const product = seo?.structuredData.find(item => item['@type'] === 'Product');

        expect(product).toMatchObject({
            offers: {
                '@type': 'Offer',
                price: '125.00',
                priceCurrency: 'MYR',
                availability: 'https://schema.org/InStock',
                shippingDetails: {
                    '@type': 'OfferShippingDetails',
                    shippingRate: {
                        '@type': 'MonetaryAmount',
                        value: '0.00',
                        currency: 'MYR',
                    },
                    shippingDestination: {
                        '@type': 'DefinedRegion',
                        addressCountry: 'MY',
                    },
                    deliveryTime: {
                        '@type': 'ShippingDeliveryTime',
                        handlingTime: {
                            '@type': 'QuantitativeValue',
                            minValue: 0,
                            maxValue: 0,
                            unitCode: 'DAY',
                        },
                        transitTime: {
                            '@type': 'QuantitativeValue',
                            minValue: 0,
                            maxValue: 0,
                            unitCode: 'DAY',
                        },
                    },
                },
                hasMerchantReturnPolicy: {
                    '@type': 'MerchantReturnPolicy',
                    applicableCountry: 'MY',
                    returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
                },
            },
        });
    });

    it('uses the configured country, seven-day return window and manual service SLA', async () => {
        const test = productFixture({
            productFields: { refundPolicy: 'SEVEN_DAY_NO_REASON', manualDeliverySlaMinutes: 1441 },
            variantFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
            commerce: { countryCode: 'CN' },
        });
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        expect(seo?.structuredData.find(item => item['@type'] === 'Product')).toMatchObject({
            offers: {
                shippingDetails: {
                    shippingRate: { value: '0.00', currency: 'MYR' },
                    shippingDestination: { addressCountry: 'CN' },
                    deliveryTime: { handlingTime: { minValue: 0, maxValue: 2, unitCode: 'DAY' } },
                },
                hasMerchantReturnPolicy: {
                    applicableCountry: 'CN',
                    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
                    merchantReturnDays: 7,
                },
            },
        });
    });

    it('uses the configured tax-inclusive shipping charge and omits fixed returns for merchant review', async () => {
        const test = productFixture({
            productFields: { refundPolicy: 'MERCHANT_REVIEW' },
            variantFields: { fulfillmentType: 'physical' },
            commerce: {
                countryCode: 'CN',
                ready: true,
                shippingMethodId: 'standard',
                shippingSourceCurrencyCode: CurrencyCode.MYR,
                blockedPostalPrefixes: '',
                baseRate: 1500,
                freeShippingThreshold: 20000,
                shippingPriceIncludesTax: false,
                shippingTaxRate: 10,
                estimateMinDays: 2,
                estimateMaxDays: 5,
            },
        });
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        const physicalProduct = seo?.structuredData.find(item => item['@type'] === 'Product');
        expect(physicalProduct).toMatchObject({
            offers: {
                shippingDetails: {
                    shippingRate: { value: '16.50', currency: 'MYR' },
                    shippingDestination: { addressCountry: 'CN' },
                    deliveryTime: {
                        transitTime: { minValue: 2, maxValue: 5, unitCode: 'DAY' },
                    },
                },
            },
        });
        expect(physicalProduct).not.toHaveProperty('offers.hasMerchantReturnPolicy');
    });

    it.each([
        { shippingSourceCurrencyCode: CurrencyCode.USD },
        { blockedPostalPrefixes: '98' },
        { shippingMethodId: null },
    ])('omits a physical shipping claim when the checkout rate is unverified (%j)', async overrides => {
        const test = productFixture({
            variantFields: { fulfillmentType: 'physical' },
            commerce: {
                countryCode: 'MY',
                ready: true,
                shippingMethodId: 'standard',
                shippingSourceCurrencyCode: CurrencyCode.MYR,
                blockedPostalPrefixes: '',
                baseRate: 1500,
                freeShippingThreshold: 10000,
                ...overrides,
            },
        });
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        expect(seo?.structuredData.find(item => item['@type'] === 'Product')).not.toHaveProperty(
            'offers.shippingDetails',
        );
    });

    it('keeps the price without inventing a country for shipping or returns', async () => {
        const test = productFixture({
            productFields: { refundPolicy: 'NON_REFUNDABLE' },
            variantFields: { fulfillmentType: 'digital' },
        });
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        const product = seo?.structuredData.find(item => item['@type'] === 'Product');
        expect(product).toHaveProperty('offers.price', '125.00');
        expect(product).not.toHaveProperty('offers.shippingDetails');
        expect(product).not.toHaveProperty('offers.hasMerchantReturnPolicy');
    });
});

describe('request-local public SEO preparation', () => {
    it.each([1, 2, 3])(
        'uses only store %s sharing settings on its domain homepage in both languages',
        async id => {
            for (const languageCode of [LanguageCode.zh_Hans, LanguageCode.en]) {
                const test = fixture();
                const host = `store-${id}.example`;
                const name = languageCode === LanguageCode.en ? `Store ${id}` : `店铺${id}`;
                const ctx = {
                    ...test.ctx,
                    channelId: `channel-${id}`,
                    channel: { code: `store-${id}` },
                    languageCode,
                    copy: (changes: Partial<RequestContext>) => ({ ...ctx, ...changes }) as RequestContext,
                } as RequestContext;
                test.domains.findOne.mockResolvedValue({ domain: host });
                test.page.scope = { ...test.page.scope, host, channelCode: ctx.channel.code, languageCode };
                test.page.config = {
                    ...(test.page.config as object),
                    customFields: { storefrontNameZh: `店铺${id}`, storefrontNameEn: `Store ${id}` },
                    logoUrl: `/assets/logo-${id}.png`,
                };
                test.sharing.publicShareMetadata.mockResolvedValue({
                    siteName: name,
                    title: `${name} · 已保存的分享标题`,
                    description: `${name}的分享介绍`,
                    image: `/assets/source/store-${id}-share.png`,
                });
                const result = await test.service.enrich(ctx, host, test.page);
                expect(test.sharing.publicShareMetadata).toHaveBeenCalledWith(ctx);
                expect(result.seo).toMatchObject({
                    siteName: name,
                    title: name,
                    shareTitle: `${name} · 已保存的分享标题`,
                    shareDescription: `${name}的分享介绍`,
                    image: `https://${host}/assets/source/store-${id}-share.png`,
                    canonical: `https://${host}/${languageCode === LanguageCode.en ? 'en' : 'zh'}/`,
                });
                expect(result.seo?.image).not.toContain('logo');
            }
        },
    );
    it.each(['terms', 'privacy'] as const)(
        'uses the published %s item body when the legal block overview is empty',
        async kind => {
            const test = fixture();
            test.page.request = { kind: 'page', id: kind };
            test.page.content = {
                blocks: [
                    {
                        type: 'LEGAL',
                        code: 'store-legal',
                        title: 'Legal documents',
                        subtitle: '',
                        body: '',
                        items: [
                            {
                                targetType: 'PAGE',
                                targetValue: 'terms',
                                label: 'Terms of use',
                                description: 'Published terms body',
                            },
                            {
                                targetType: 'PAGE',
                                targetValue: 'privacy',
                                label: 'Privacy Policy',
                                description: 'Published privacy body',
                            },
                        ],
                    },
                ],
            };
            const enriched = await test.service.enrich(test.ctx, test.host, test.page);
            expect(enriched.seo).toMatchObject({
                indexable: true,
                title: `${kind === 'terms' ? 'Terms of use' : 'Privacy Policy'} | Published store`,
                description: `Published ${kind} body`,
                reasons: [],
            });
        },
    );

    it.each(['missing-document', 'different-host'])(
        'keeps legal pages excluded when the matching document is unavailable: %s',
        async reason => {
            const test = fixture();
            test.page.request = { kind: 'page', id: 'terms' };
            test.page.content = {
                blocks: [
                    {
                        type: 'LEGAL',
                        code: 'store-legal',
                        title: 'Legal documents',
                        subtitle: '',
                        body: '',
                        items: [
                            {
                                targetType: 'PAGE',
                                targetValue: reason === 'missing-document' ? 'privacy' : 'terms',
                                label: 'Published document',
                                description:
                                    reason === 'different-host'
                                        ? 'Applies to other-store.invalid only.'
                                        : 'Published privacy body',
                            },
                        ],
                    },
                ],
            };
            const enriched = await test.service.enrich(test.ctx, test.host, test.page);
            expect(enriched.seo?.indexable).toBe(false);
            expect(enriched.seo?.robots).toContain('noindex');
        },
    );

    it('starts independent document and profile reads while configuration is still pending', async () => {
        const test = fixture();
        let resolveConfiguration!: (value: typeof test.configuration) => void;
        test.seo.publishedConfiguration.mockReturnValue(
            new Promise(resolve => {
                resolveConfiguration = resolve;
            }),
        );

        const pending = test.service.prepare(test.ctx, test.host, { kind: 'home' });

        expect(test.domains.findOne).toHaveBeenCalledOnce();
        expect(test.seo.publishedRecord).toHaveBeenCalledWith(test.ctx, {
            targetType: 'HOME',
            targetId: 'home',
            languageCode: 'en',
        });
        expect(test.profiles.findOne).toHaveBeenCalledOnce();
        resolveConfiguration(test.configuration);
        await expect(pending).resolves.toMatchObject({
            configuration: test.configuration,
            primary: test.host,
            record: null,
            profile: test.profile,
            scope: {
                channelId: 'synthetic-channel',
                channelCode: 'synthetic-store',
                languageCode: 'en',
                currencyCode: 'MYR',
                host: test.host,
                requestKey: '{"kind":"home"}',
            },
        });
    });

    it.each([true, false])('reuses supplied configuration and primary, including null: %s', async present => {
        const test = fixture();
        const initial: StorefrontPublicSeoInitial = {
            configuration: present ? test.configuration : null,
            primary: present ? test.host : null,
        };

        const prepared = await test.service.prepare(test.ctx, test.host, { kind: 'home' }, initial);
        const enriched = await test.service.enrich(test.ctx, test.host, test.page, prepared);

        expect(prepared.configuration).toBe(initial.configuration);
        expect(prepared.primary).toBe(initial.primary);
        expect(enriched.seo?.version).toBe(present ? 1 : 0);
        expect(test.seo.publishedConfiguration).not.toHaveBeenCalled();
        expect(test.domains.findOne).not.toHaveBeenCalled();
        expect(test.seo.publishedRecord).toHaveBeenCalledOnce();
        expect(test.profiles.findOne).toHaveBeenCalledOnce();
        expect(test.pages.getAccessMode).toHaveBeenCalledOnce();
    });

    it('uses article metadata and the store sharing image without reusing the legacy cover', async () => {
        const test = fixture(LanguageCode.zh_Hans);
        test.page.request = { kind: 'blog', id: 'verified-update', input: {} };
        test.page.config = {
            ...(test.page.config as object),
            logoUrl: '/assets/store-logo.webp',
            customFields: { storefrontNameZh: '测试店铺' },
        };
        test.profile.descriptionZh = '中文店铺说明';
        test.page.blog = {
            title: '栏目标题',
            description: '栏目说明',
            items: [],
            totalItems: 1,
            featured: null,
            relatedArticles: [],
            article: {
                title: '审核后的具体更新',
                summary: '文章摘要',
                seoDescription: '文章说明',
                cover: { url: '/assets/cover.webp' },
                publishedAt: '2026-11-01T00:00:00Z',
                reviewedAt: '2026-11-01T01:00:00Z',
                reviewerName: '编辑',
                sources: [],
            } as never,
        };
        test.seo.publishedRecord.mockResolvedValue({
            version: 2,
            payload: {
                title: '通用栏目标题',
                description: '通用栏目说明',
                shareTitle: '通用分享标题',
                shareDescription: '通用分享说明',
                shareImageUrl: '/assets/generic.webp',
                indexMode: 'NOINDEX',
            },
        });
        const enriched = await test.service.enrich(test.ctx, test.host, test.page);
        expect(enriched.seo?.title).toContain('审核后的具体更新');
        expect(enriched.seo?.shareTitle).toContain('审核后的具体更新');
        expect(enriched.seo?.description).toBe('文章说明');
        expect(enriched.seo?.image).toBe('https://synthetic-store.invalid/assets/store-logo.webp');
        expect(enriched.seo?.indexable).toBe(false);
        expect(enriched.seo?.structuredData).toContainEqual(
            expect.objectContaining({
                '@type': 'BlogPosting',
                image: [`https://${test.host}/assets/store-logo.webp`],
            }),
        );
    });

    it('uses the English article for canonical metadata and advertises only available translations', async () => {
        const test = fixture(LanguageCode.en);
        test.configuration.payload.enabledLanguages = ['en', 'zh_Hans'];
        test.page.request = {
            kind: 'blog',
            id: 'release-notes',
            input: { term: 'release', category: 'chatgpt', skip: 12, fromBlogList: 'en' },
        };
        test.page.blog = {
            title: 'AI news',
            description: 'Official news and analysis.',
            totalItems: 1,
            availableLanguages: ['en', 'zh_Hans'],
            items: [],
            featured: null,
            relatedArticles: [],
            article: {
                title: 'New release notes',
                summary: 'A product update.',
                seoDescription: 'What changed in the release.',
                publishedAt: '2026-11-03T00:00:00Z',
                sourcePublishedAt: '2026-10-27T00:00:00Z',
                sources: [{ url: 'https://example.org/release' }],
            } as never,
        };
        const seo = (await test.service.enrich(test.ctx, test.host, test.page)).seo;
        if (!seo) throw new Error('Missing public SEO metadata');
        expect(seo).toMatchObject({
            indexable: true,
            canonical: `https://${test.host}/en/blog/release-notes`,
            description: 'What changed in the release.',
        });
        expect(seo.alternates.map(link => link.language)).toEqual(['en', 'zh-CN', 'x-default']);
        expect(seo.structuredData).toContainEqual(
            expect.objectContaining({
                '@type': 'BlogPosting',
                inLanguage: 'en',
                headline: 'New release notes',
                datePublished: '2026-11-03T00:00:00Z',
            }),
        );
        test.page.blog.availableLanguages = ['en'];
        expect(
            (await test.service.enrich(test.ctx, test.host, test.page)).seo?.alternates.map(
                link => link.language,
            ),
        ).toEqual(['en', 'x-default']);
    });

    it('does not index an English Skill list without a published edition', async () => {
        const test = fixture(LanguageCode.en);
        test.configuration.payload.enabledLanguages = ['en', 'zh_Hans'];
        test.page.request = { kind: 'blog', input: { category: 'skills' } };
        test.page.blog = {
            title: 'AI news',
            description: 'Official news and analysis.',
            totalItems: 0,
            availableLanguages: [],
            items: [],
            featured: null,
            relatedArticles: [],
            article: null,
        };
        const { seo } = await test.service.enrich(test.ctx, test.host, test.page);
        expect(seo).toMatchObject({ indexable: false, alternates: [] });
    });
    it('keeps preparation automatic for callers that only supply the page', async () => {
        const test = fixture();

        const enriched = await test.service.enrich(test.ctx, test.host, test.page);

        expect(enriched.seo).toMatchObject({
            canonical: `https://${test.host}/en/`,
            version: 1,
            title: 'Published store',
        });
        expect(test.seo.publishedConfiguration).toHaveBeenCalledOnce();
        expect(test.domains.findOne).toHaveBeenCalledOnce();
        expect(test.pages.getAccessMode).toHaveBeenCalledOnce();
    });

    it.each(['channelId', 'channelCode', 'languageCode', 'currencyCode', 'host', 'requestKey'] as const)(
        'rejects preparation for a different %s before consuming its metadata',
        async field => {
            const test = fixture();
            const prepared = await test.service.prepare(test.ctx, test.host, { kind: 'home' });
            const ctx = {
                ...test.ctx,
                ...(field === 'channelId' ? { channelId: 'another-channel' } : {}),
                ...(field === 'channelCode' ? { channel: { code: 'another-store' } } : {}),
                ...(field === 'languageCode' ? { languageCode: LanguageCode.zh_Hans } : {}),
                ...(field === 'currencyCode' ? { currencyCode: CurrencyCode.USD } : {}),
            } as RequestContext;
            const host = field === 'host' ? 'another-store.invalid' : test.host;
            const page =
                field === 'requestKey'
                    ? { ...test.page, request: { kind: 'page', id: 'support' } as PublicPageRequest }
                    : test.page;

            await expect(test.service.enrich(ctx, host, page, prepared)).rejects.toThrow(
                'Public SEO preparation scope changed',
            );
            expect(test.pages.getAccessMode).not.toHaveBeenCalled();
            expect(test.content.findPublished).not.toHaveBeenCalled();
        },
    );

    it('still reads closure state after preparation before returning enriched metadata', async () => {
        const test = fixture();
        const prepared = await test.service.prepare(test.ctx, test.host, { kind: 'home' });
        test.pages.getAccessMode.mockResolvedValue('CLOSED');

        await expect(test.service.enrich(test.ctx, test.host, test.page, prepared)).rejects.toMatchObject({
            code: 'STOREFRONT_CLOSED',
        });
        expect(test.pages.getAccessMode).toHaveBeenCalledOnce();
    });

    it('does not reuse prepared publication or domain reads in the final output authority check', async () => {
        const test = fixture();
        const prepared = await test.service.prepare(
            test.ctx,
            test.host,
            { kind: 'home' },
            {
                configuration: test.configuration,
                primary: test.host,
            },
        );
        const enriched = await test.service.enrich(test.ctx, test.host, test.page, prepared);
        test.seo.publishedConfiguration.mockResolvedValue({ ...test.configuration, version: 2 });

        await expect(test.service.assertOutput(test.ctx, enriched)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(test.seo.publishedConfiguration).toHaveBeenCalledOnce();
        expect(test.domains.findOne).toHaveBeenCalledOnce();
        expect(test.seo.publishedRecord).toHaveBeenCalledTimes(2);
        expect(test.pages.getAccessMode).toHaveBeenCalledTimes(2);
    });
});
