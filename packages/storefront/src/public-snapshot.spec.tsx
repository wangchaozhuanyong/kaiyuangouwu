// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    publicPageRequestFromUrl,
    publicPageRequestKey,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { fixtureKinds, fixtureLanguages, fixtureStores, syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { renderPublicPage } from './entry-public-server';
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
