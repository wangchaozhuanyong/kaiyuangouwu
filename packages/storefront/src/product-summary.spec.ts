// organize-imports-ignore
import type { Product } from './types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { projectProductDescription } from '../../common/src/product-description-summary';

import { productFields, productSummaryFields } from './api/fragments';
import { buildProductRowSmartInfo } from './components/common/product-row';
import { asListProduct } from './product-summary';
import { storefrontQueryKeys } from './query-client';
import { seedPublicPage, type PublicPageData } from './storefront-page-data';
import { resolveProductSubtitle, trimText } from './storefront-ui/product-display';

function fullProduct(description: string, name = '商品标题'): Product {
    return {
        id: 'product-a',
        createdAt: '2026-01-01T00:00:00Z',
        name,
        slug: 'product-a',
        description,
        assets: [],
        featuredAsset: null,
        variants: [],
        collections: [{ id: 'category', name: '配置的分类', slug: 'category', parentId: 'root' }],
    };
}

function compactProduct(product: Product) {
    const { description, assets: _assets, ...identity } = product;
    return { ...identity, ...projectProductDescription(description, product.name) };
}

describe('compact product display compatibility', () => {
    it.each([
        '<p>按照官方Api价格为基础计算，1人民币可以购买1元美金的Token额度。</p>',
        `<p>${'完整说明内容'.repeat(40)}</p><p>质保：一个月</p>`,
        `<p>${'A useful product description. '.repeat(20)}</p><p>Warranty for 12 months</p>`,
        '<p>  商品标题 </p>这段正文以完整标题开头，不应冒充副标题。',
        '1',
        '123 : / 456',
        '<p> </p>',
        '<p>规格 &amp; 服务</p>\n<p>保修30天</p>',
    ])('preserves subtitles, 72-character excerpts and full-body warranty for %s', description => {
        const full = fullProduct(description);
        const compact = compactProduct(full);
        const card = asListProduct(compact);
        expect(compact).not.toHaveProperty('description');
        expect(compact.descriptionSummary.length).toBeLessThanOrEqual(73);
        expect(trimText(card.description, 72)).toBe(trimText(full.description, 72));
        for (const length of [26, 48, 72]) {
            for (const preferClause of [true, false]) {
                expect(resolveProductSubtitle(card, length, preferClause)).toBe(
                    resolveProductSubtitle(full, length, preferClause),
                );
            }
        }
        for (const language of ['zh', 'en'] as const) {
            expect(buildProductRowSmartInfo(card, language)).toEqual(
                buildProductRowSmartInfo(full, language),
            );
        }
    });

    it('checks duplicate-title eligibility before shortening a title longer than the excerpt', () => {
        const full = fullProduct(`${'很长的商品名称'.repeat(20)} 商家补充`, '很长的商品名称'.repeat(20));
        const card = asListProduct(compactProduct(full));
        expect(card.descriptionSubtitle).toBeNull();
        expect(resolveProductSubtitle(card)).toBe('配置的分类');
        expect(resolveProductSubtitle(card)).toBe(resolveProductSubtitle(full));
    });

    it('retains a warranty at the end of a long body in both display languages', () => {
        const full = fullProduct(`${'文字'.repeat(200)}<p>Guarantee of 90 days</p>`);
        const card = asListProduct(compactProduct(full));
        expect(card.description).not.toContain('Guarantee');
        expect(card.warrantyDuration).toBe('90 days');
        expect(buildProductRowSmartInfo(card, 'en').secondary).toBe('Warranty 90 days');
        expect(buildProductRowSmartInfo(card, 'zh').secondary).toBe('质保90 days');
    });

    it('hydrates compact cards without replacing the complete detail body or gallery', () => {
        const client = new QueryClient();
        const full = fullProduct(`${'详情'.repeat(100)} 质保30天`);
        full.assets = [{ id: 'gallery', preview: '/gallery.webp' }];
        const detailKey = storefrontQueryKeys.product('store-a:MYR', 'en', full.id);
        client.setQueryData(detailKey, full);
        seedPublicPage(
            client,
            {
                scope: { channelCode: 'store-a', currencyCode: 'MYR', languageCode: 'en' },
                generatedAt: Date.now() + 1,
                products: [compactProduct(full)],
            } as PublicPageData,
            false,
        );
        const cards = client.getQueryData<Product[]>(storefrontQueryKeys.products('store-a:MYR', 'en', 12));
        expect(cards?.[0].description).toBe(trimText(full.description, 72));
        expect(cards?.[0].warrantyDuration).toBe('30天');
        expect(client.getQueryData(detailKey)).toEqual(full);
        client.clear();
    });

    it('keeps legacy GraphQL descriptions without requesting compact fields absent from old schemas', () => {
        expect(productSummaryFields).toMatch(/\n\s+description\n/u);
        expect(productSummaryFields).not.toMatch(/\n\s+assets\s*\{/u);
        expect(productSummaryFields).not.toMatch(/descriptionSummary|descriptionSubtitle|warrantyDuration/u);
        expect(productFields).toMatch(/\n\s+assets\s*\{/u);
        const full = fullProduct('<p>旧部署正文，质保30天</p>');
        expect(asListProduct(full).description).toBe(full.description);
    });
});
