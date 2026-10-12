// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    publicPageRequestFromUrl,
    publicPageRequestKey,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { fixtureKinds, fixtureLanguages, fixtureStores, syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { renderPublicPage } from './entry-public-server';
import { ImagePlaceholder } from './safe-image';
import { StorefrontPageFrame } from './storefront-page-frame';
import { type StorefrontFlashSale, type StorefrontSystemAnnouncement } from './types';

function fixtureValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected the synthetic fixture value');
    return value;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('anonymous shared public component server render', () => {
    it('releases per-request query GC timers even when a normalized category has no seeded result', async () => {
        vi.useFakeTimers();
        try {
            const page = syntheticPage(fixtureStores[0], 'en', 'catalog');
            page.request = {
                kind: 'catalog',
                path: '/category',
                input: { sort: 'RECOMMENDED', inStockOnly: false, skip: 0, take: 12 },
            };
            page.requestKey = publicPageRequestKey(page.request);
            page.route = '/en/category';
            const timers = vi.getTimerCount();
            const html = await renderPublicPage(page);
            expect(html).toContain('class="page category-page"');
            expect(html).toContain('aria-pressed="true"');
            expect(html).toContain('list-skeleton category-product-list');
            expect(vi.getTimerCount()).toBe(timers);
        } finally {
            vi.useRealTimers();
        }
    });
    it.each(fixtureLanguages)(
        '%s renders a confirmed missing product and guide as their empty route',
        async languageCode => {
            const productPage = syntheticPage(fixtureStores[0], languageCode, 'product');
            productPage.product = null;
            const productHtml = await renderPublicPage(productPage);
            expect(productHtml).toContain(languageCode === 'en' ? 'Product not found' : '没有找到商品');
            expect(productHtml).not.toContain('class="page home-page"');
            const guidePage = syntheticPage(fixtureStores[0], languageCode, 'article');
            delete guidePage.publicContent;
            const guideHtml = await renderPublicPage(guidePage);
            expect(guideHtml).toContain(
                languageCode === 'en' ? 'Published guide not found' : '没有找到已发布的指南',
            );
            expect(guideHtml).not.toContain('class="page home-page"');
        },
    );
    it.each(fixtureLanguages)(
        '%s renders the persistent runtime frame and mobile navigation in HTML',
        async languageCode => {
            const page = syntheticPage(fixtureStores[0], languageCode, 'home');
            const html = await renderPublicPage(page);
            expect(html).toContain('data-page-readiness="ready"');
            expect(html).toContain('class="page-readiness-stage"');
            expect(html).toContain('data-route="home"');
            expect(html).toContain('data-page-family="discovery"');
            expect(html.match(/id="storefront-content"/gu)).toHaveLength(1);
            expect(html.match(/class="storefront-bottom-nav"/gu)).toHaveLength(1);
            expect(html).toContain(languageCode === 'en' ? 'Skip to content' : '跳到主要内容');
        },
    );

    it('uses the same English accessibility fallback for missing media before hydration', async () => {
        const imageHtml = renderToString(
            <StorefrontPageFrame
                routeName="support"
                language="en"
                desktop={false}
                storefrontName="Example"
                logoUrl={null}
            >
                <ImagePlaceholder />
            </StorefrontPageFrame>,
        );
        expect(imageHtml).toContain('No product image');
        expect(imageHtml).not.toContain('暂无商品图片');
        const page = syntheticPage(fixtureStores[0], 'en', 'product');
        const product = fixtureValue(page.product);
        product.featuredAsset = null;
        product.assets = [];
        product.variants.forEach(variant => {
            variant.featuredAsset = null;
        });
        const html = await renderPublicPage(page);
        expect(html).toContain('No image');
        expect(html).not.toContain('暂无商品图');
    });

    it('normalizes invalid legacy brand names identically to the interactive runtime', async () => {
        const page = syntheticPage(fixtureStores[0], 'en', 'home');
        page.config.customFields.storefrontNameEn =
            'A legacy storefront name that exceeds the merchant display limit';
        const html = await renderPublicPage(page);
        expect(html).toContain('<span class="proto-brand-text">Store</span>');
        expect(html).not.toContain('proto-brand-text">A legacy storefront');
    });

    for (const languageCode of fixtureLanguages)
        for (const id of ['services', 'support', 'terms', 'privacy'] as const) {
            it(`${languageCode}/${id} loads the requested public page rather than homepage dependencies`, async () => {
                const page = syntheticPage(fixtureStores[0], languageCode, 'home');
                page.request = { kind: 'page', id };
                page.requestKey = publicPageRequestKey(page.request);
                page.route = `/${languageCode === 'zh_Hans' ? 'zh' : 'en'}/${id}`;
                const html = await renderPublicPage(page);
                expect(html).not.toContain('class="page home-page"');
                expect(html).toContain('id="storefront-content"');
                if (id === 'terms' || id === 'privacy') expect(html).toContain('legal-page');
                else if (id === 'services') expect(html).toContain('business-services-page');
                else
                    expect(html).toContain(
                        languageCode === 'zh_Hans' ? '客服信息暂未配置' : 'Support is not configured yet',
                    );
            });
        }

    it.each(fixtureLanguages)(
        '%s keeps the initial flash-sale countdown identical after a hydration delay',
        async languageCode => {
            const generatedAt = Date.parse('2026-10-11T12:00:00.000Z');
            const clock = vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
            const page = syntheticPage(fixtureStores[0], languageCode, 'home', { generatedAt });
            const content = fixtureValue(page.content);
            const product = fixtureValue(page.products)[0];
            const flashSale: StorefrontFlashSale = {
                id: 'synthetic-hydration-flash-sale',
                startsAt: null,
                endsAt: new Date(generatedAt + 120_000).toISOString(),
                items: [
                    {
                        productId: product.id,
                        productVariantId: product.variants[0].id,
                        productName: product.name,
                        variantName: product.variants[0].name,
                        originalPrice: product.variants[0].priceWithTax,
                        salePrice: 1_200,
                        currencyCode: product.variants[0].currencyCode,
                        imageUrl: fixtureValue(product.featuredAsset).preview,
                    },
                ],
            };
            content.blocks.push({
                ...content.blocks[0],
                id: 'synthetic-hydration-flash-sale-block',
                code: 'synthetic-hydration-flash-sale-block',
                type: 'FLASH_SALE',
                title: languageCode === 'zh_Hans' ? '合成秒杀' : 'Synthetic flash sale',
                items: [],
            });
            fixtureValue(content.settings.configuredBlockTypes).push('FLASH_SALE');
            page.flashSales = [flashSale];
            const serverHtml = await renderPublicPage(page);
            expect(serverHtml).toContain('class="flash-sale-card"');
            expect(serverHtml).toContain('<strong>0 : 02 : 00</strong>');

            clock.mockReturnValue(generatedAt + 2_500);
            const hydrationHtml = await renderPublicPage(page);
            expect(hydrationHtml).toBe(serverHtml);
        },
    );

    it.each(fixtureLanguages)(
        '%s keeps an expiring announcement in the same initial snapshot after a hydration delay',
        async languageCode => {
            const generatedAt = Date.parse('2026-10-11T12:00:00.000Z');
            const clock = vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
            const page = syntheticPage(fixtureStores[0], languageCode, 'home', { generatedAt });
            const content = fixtureValue(page.content);
            const announcement: StorefrontSystemAnnouncement = {
                id: 'synthetic-hydration-announcement',
                createdAt: new Date(generatedAt - 60_000).toISOString(),
                title: languageCode === 'zh_Hans' ? '合成到期公告' : 'Synthetic expiring announcement',
                content: languageCode === 'zh_Hans' ? '合成公告正文' : 'Synthetic announcement body',
                linkUrl: null,
                startsAt: new Date(generatedAt - 60_000).toISOString(),
                endsAt: new Date(generatedAt + 1_000).toISOString(),
            };
            content.blocks.push({
                ...content.blocks[0],
                id: 'synthetic-hydration-notice-block',
                code: 'synthetic-hydration-notice-block',
                type: 'NOTICE',
                title: '',
                items: [],
            });
            fixtureValue(content.settings.configuredBlockTypes).push('NOTICE');
            content.systemAnnouncements = [announcement];
            const serverHtml = await renderPublicPage(page);
            expect(serverHtml).toContain(announcement.title);
            expect(serverHtml).toContain(announcement.content);

            clock.mockReturnValue(generatedAt + 2_500);
            const hydrationHtml = await renderPublicPage(page);
            expect(hydrationHtml).toBe(serverHtml);
        },
    );

    it('sends homepage critical styles with the actual first HTML and reserves deferred catalogs', async () => {
        const page = syntheticPage(fixtureStores[0], 'zh_Hans', 'home');
        const content = fixtureValue(page.content);
        for (const type of ['BEST_SELLERS', 'RECOMMENDATIONS'] as const) {
            content.blocks.push({ ...content.blocks[0], id: type, type, items: [] });
            fixtureValue(content.settings.configuredBlockTypes).push(type);
        }
        const html = await renderPublicPage(page);
        expect(html).toContain('data-href="storefront-home-showcase"');
        expect(html.indexOf('storefront-home-showcase')).toBeLessThan(html.indexOf('class="page home-page"'));
        expect(html).toContain('data-home-catalog="sales"');
        expect(html).toContain('data-home-catalog="recommended"');
    });

    it('does not call unavailable managed selections an empty collection during the snapshot', async () => {
        const page = syntheticPage(fixtureStores[0], 'zh_Hans', 'home');
        const block = fixtureValue(page.content).blocks.find(
            candidate => candidate.type === 'FEATURED_COLLECTION',
        );
        fixtureValue(block).settings = { selectedProductIds: ['not-in-bootstrap'], displayCount: 4 };
        const html = await renderPublicPage(page);
        expect(html).not.toContain('精选商品即将上架');
        expect(html).toContain('featured-collection-mosaic');
        expect(html).toContain('aria-busy="true"');
    });

    it.each(fixtureLanguages)(
        '%s keeps the initial flash-sale countdown identical after a hydration delay',
        async languageCode => {
            const generatedAt = Date.parse('2026-10-11T12:00:00.000Z');
            const clock = vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
            const page = syntheticPage(fixtureStores[0], languageCode, 'home', { generatedAt });
            const content = fixtureValue(page.content);
            const product = fixtureValue(page.products)[0];
            const flashSale: StorefrontFlashSale = {
                id: 'synthetic-hydration-flash-sale',
                startsAt: null,
                endsAt: new Date(generatedAt + 120_000).toISOString(),
                items: [
                    {
                        productId: product.id,
                        productVariantId: product.variants[0].id,
                        productName: product.name,
                        variantName: product.variants[0].name,
                        originalPrice: product.variants[0].priceWithTax,
                        salePrice: 1_200,
                        currencyCode: product.variants[0].currencyCode,
                        imageUrl: fixtureValue(product.featuredAsset).preview,
                    },
                ],
            };
            content.blocks.push({
                ...content.blocks[0],
                id: 'synthetic-hydration-flash-sale-block',
                code: 'synthetic-hydration-flash-sale-block',
                type: 'FLASH_SALE',
                title: languageCode === 'zh_Hans' ? '合成秒杀' : 'Synthetic flash sale',
                items: [],
            });
            fixtureValue(content.settings.configuredBlockTypes).push('FLASH_SALE');
            page.flashSales = [flashSale];
            const serverHtml = await renderPublicPage(page);
            expect(serverHtml).toContain('class="flash-sale-card"');
            expect(serverHtml).toContain('<strong>0 : 02 : 00</strong>');

            clock.mockReturnValue(generatedAt + 2_500);
            const hydrationHtml = await renderPublicPage(page);
            expect(hydrationHtml).toBe(serverHtml);
        },
    );

    it.each(fixtureLanguages)(
        '%s keeps an expiring announcement in the same initial snapshot after a hydration delay',
        async languageCode => {
            const generatedAt = Date.parse('2026-10-11T12:00:00.000Z');
            const clock = vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
            const page = syntheticPage(fixtureStores[0], languageCode, 'home', { generatedAt });
            const content = fixtureValue(page.content);
            const announcement: StorefrontSystemAnnouncement = {
                id: 'synthetic-hydration-announcement',
                createdAt: new Date(generatedAt - 60_000).toISOString(),
                title: languageCode === 'zh_Hans' ? '合成到期公告' : 'Synthetic expiring announcement',
                content: languageCode === 'zh_Hans' ? '合成公告正文' : 'Synthetic announcement body',
                linkUrl: null,
                startsAt: new Date(generatedAt - 60_000).toISOString(),
                endsAt: new Date(generatedAt + 1_000).toISOString(),
            };
            content.blocks.push({
                ...content.blocks[0],
                id: 'synthetic-hydration-notice-block',
                code: 'synthetic-hydration-notice-block',
                type: 'NOTICE',
                title: '',
                items: [],
            });
            fixtureValue(content.settings.configuredBlockTypes).push('NOTICE');
            content.systemAnnouncements = [announcement];
            const serverHtml = await renderPublicPage(page);
            expect(serverHtml).toContain(announcement.title);
            expect(serverHtml).toContain(announcement.content);

            clock.mockReturnValue(generatedAt + 2_500);
            const hydrationHtml = await renderPublicPage(page);
            expect(hydrationHtml).toBe(serverHtml);
        },
    );

    it.each(fixtureLanguages)(
        '%s keeps the brand introduction without restoring a configured disabled or unpublished footer',
        async languageCode => {
            const page = syntheticPage(fixtureStores[0], languageCode, 'home');
            const name =
                languageCode === 'zh_Hans'
                    ? fixtureValue(page.config.customFields.storefrontNameZh)
                    : fixtureValue(page.config.customFields.storefrontNameEn);
            const tagline =
                languageCode === 'zh_Hans' ? '精选商品，便捷购物' : 'Selected products, simple shopping';
            page.config.tagline = tagline;
            // Publication omits both disabled and unpublished blocks but retains their configured type.
            fixtureValue(fixtureValue(page.content).settings.configuredBlockTypes).push('FOOTER');
            expect(fixtureValue(page.content).blocks.some(block => block.type === 'FOOTER')).toBe(false);
            const html = await renderPublicPage(page);
            expect(html.match(/class="legal-footer-introduction"/gu)).toHaveLength(1);
            expect(html).toContain(`<h2 class="legal-footer-title">${name} · ${tagline}</h2>`);
            expect(html).toContain(`>${fixtureValue(page.config.description)}</p>`);
            expect(html).not.toContain('aria-label="服务与政策"');
            expect(html).not.toContain('aria-label="Service and policies"');
            expect(html).not.toContain('隐私政策');
            expect(html).not.toContain('使用条款');
            expect(html).not.toContain('Privacy Policy');
            expect(html).not.toContain('Terms of use');
        },
    );

    it('preserves legacy footer rendering when older public data omits configured block types', async () => {
        const page = syntheticPage(fixtureStores[0], 'en', 'home');
        delete fixtureValue(page.content).settings.configuredBlockTypes;
        const html = await renderPublicPage(page);
        expect(html).toContain('legal-footer-introduction');
        expect(html).toContain('Privacy Policy');
        expect(html).toContain('Terms of use');
    });

    for (const store of fixtureStores)
        for (const languageCode of fixtureLanguages)
            for (const kind of fixtureKinds) {
                it(`${store}/${languageCode}/${kind} renders scoped real content without browser globals or requests`, async () => {
                    expect(typeof window).toBe('undefined');
                    expect(typeof document).toBe('undefined');
                    const fetch = vi.fn(() => {
                        throw new Error('Anonymous server rendering must not fetch');
                    });
                    const sessionRead = vi.fn(() => {
                        throw new Error('Anonymous server rendering must not read a session');
                    });
                    vi.stubGlobal('fetch', fetch);
                    vi.stubGlobal('sessionStorage', { getItem: sessionRead });
                    const page = syntheticPage(store, languageCode, kind);
                    expect(publicPageRequestKey(fixtureValue(publicPageRequestFromUrl(page.route)))).toBe(
                        page.requestKey,
                    );
                    const html = await renderPublicPage(page);
                    const prefix = languageCode === 'zh_Hans' ? 'zh' : 'en';
                    const other = fixtureValue(fixtureStores.find(item => item !== store));
                    expect(html).toContain('id="storefront-content"');
                    expect(html).not.toContain(other);
                    expect(html).not.toContain('page-skeleton--route');
                    expect(fetch).not.toHaveBeenCalled();
                    expect(sessionRead).not.toHaveBeenCalled();
                    if (kind === 'home') {
                        expect(html).toContain('home-page');
                        expect(html).toContain(fixtureValue(page.config.description));
                        expect(html).toContain(`href="/${prefix}/category?collectionId=${store}-collection"`);
                        expect(html).toContain(`href="/${prefix}/services"`);
                        expect(html).toContain(`href="/${prefix}/product?id=${store}-product-1"`);
                    } else if (kind === 'product') {
                        expect(html).toContain('product-detail-page');
                        expect(html).toContain(fixtureValue(page.product).name);
                        expect(html).toContain(fixtureValue(page.config.description));
                    } else if (kind === 'catalog') {
                        expect(html).toContain(fixtureValue(page.catalog).items[0].name);
                        expect(html).not.toContain(`href="/${prefix}/product?id=${store}-product-1"`);
                        expect(html).toContain(`href="/${prefix}/product?id=${store}-product-13"`);
                        const categoryLinks = Array.from(
                            html.matchAll(/href="([^"]+)"/gu),
                            match => new URL(match[1].replaceAll('&amp;', '&'), 'https://fixture.test'),
                        ).filter(url => url.pathname === `/${prefix}/category`);
                        expect(
                            categoryLinks.some(
                                url =>
                                    url.searchParams.get('collectionId') === `${store}-collection` &&
                                    url.searchParams.get('page') === '3',
                            ),
                        ).toBe(true);
                        expect(html).not.toContain('You are offline');
                        expect(html).toContain(`href="/${prefix}/category?collectionId=${store}-collection"`);
                    } else {
                        expect(html).toContain(fixtureValue(page.publicContent).title);
                        expect(html).toContain(fixtureValue(page.publicContent).body);
                        expect(html).toContain('Synthetic reviewer');
                        expect(html).toContain(`href="/${prefix}/product?id=${store}-product-1"`);
                    }
                });
            }
});
