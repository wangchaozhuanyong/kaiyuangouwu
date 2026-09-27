import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { categoryTargetSelection, centeredHorizontalScrollLeft } from './category-navigation';
import { routePageIdentity } from './storefront-router';
import { readStorefrontStylesheet } from './test-stylesheet';

describe('content category target navigation', () => {
    const collections = [
        {
            id: 'parent-1',
            children: [{ id: 'child-1' }, { id: 'child-2' }],
        },
        {
            id: 'parent-2',
            children: [{ id: 'child-3' }],
        },
    ];

    it('opens a selected top-level category with all of its products', () => {
        expect(categoryTargetSelection(collections, 'parent-2')).toEqual({
            collectionId: 'parent-2',
            childId: 'all',
        });
    });

    it('opens a selected child category under its actual parent', () => {
        expect(categoryTargetSelection(collections, 'child-2')).toEqual({
            collectionId: 'parent-1',
            childId: 'child-2',
        });
    });

    it('preserves legacy targets that are not present in the loaded category tree', () => {
        expect(categoryTargetSelection(collections, 'legacy-category')).toEqual({
            collectionId: 'legacy-category',
            childId: 'legacy-category',
        });
    });
});

describe('category navigation scrolling', () => {
    const container = { clientWidth: 320, scrollWidth: 720 };

    it('centers a category without changing any vertical position', () => {
        expect(centeredHorizontalScrollLeft(container, { offsetLeft: 280, offsetWidth: 70 })).toBe(155);
    });

    it('clamps the first and last categories to the horizontal scroll range', () => {
        expect(centeredHorizontalScrollLeft(container, { offsetLeft: 0, offsetWidth: 70 })).toBe(0);
        expect(centeredHorizontalScrollLeft(container, { offsetLeft: 680, offsetWidth: 70 })).toBe(400);
    });

    it('does not scroll when all categories already fit', () => {
        expect(
            centeredHorizontalScrollLeft(
                { clientWidth: 430, scrollWidth: 390 },
                { offsetLeft: 160, offsetWidth: 70 },
            ),
        ).toBe(0);
    });
});

describe('category navigation responsive spacing', () => {
    const stylesheet = readStorefrontStylesheet();
    const presetStylesheet = readFileSync(new URL('./styles/home-showcase.css', import.meta.url), 'utf8');
    const categoryPageSource = readFileSync(new URL('./pages/category-page.tsx', import.meta.url), 'utf8');

    it('keeps client plugin spacing symmetric at every insertion point', () => {
        expect(stylesheet).toMatch(
            new RegExp(
                '\\.category-client-plugin-slot\\s*\\{[^}]*--client-plugin-slot-block-space:\\s*8px;' +
                    '[^}]*padding-block:\\s*var\\(--client-plugin-slot-block-space\\);' +
                    '[^}]*padding-inline:\\s*var\\(--page-section-inset, var\\(--client-plugin-slot-inline-space\\)\\);',
            ),
        );
        expect(stylesheet).not.toMatch(
            /\.category-client-plugin-slot\.is-[^{]+\{[^}]*(?:padding-top|padding-bottom):/,
        );
        expect(stylesheet).toMatch(
            /\.business-services-page \.category-client-plugin-slot\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*padding:\s*0;/,
        );
    });

    it('uses a compact search entry and leaves the submit action on the search page', () => {
        expect(categoryPageSource).not.toContain('category-title-lockup');
        expect(categoryPageSource).not.toContain('category-mobile-heading');
        expect(categoryPageSource).not.toContain("{isZh ? '选购商品' : 'Shop'}");
        expect(categoryPageSource).not.toContain('search-trigger-action');
        expect(stylesheet).toMatch(
            /\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*padding-inline:\s*16px;/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-topbar > \.search-trigger\s*\{[^}]*width:\s*100%;[^}]*height:\s*36px;/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-topbar > \.search-trigger\s*\{[^}]*border-radius:\s*var\(--skin-control-radius\);[^}]*background:\s*var\(--control-surface\);/,
        );
        expect(stylesheet).toMatch(
            /@media \(min-width:\s*600px\)[\s\S]*?\.category-topbar\s*\{[^}]*height:\s*128px;[^}]*padding:\s*72px 24px 12px;/,
        );
    });

    it('keeps the desktop primary navigation height aligned', () => {
        expect(stylesheet).toMatch(/\.category-page\s*\{[^}]*--category-content-sticky-top:\s*209px;/);
        expect(stylesheet).toMatch(/\.primary-category-switcher\s*\{[^}]*height:\s*80px;/);
    });

    it('keeps mobile navigation visible while products and subcategories scroll independently', () => {
        expect(stylesheet).toMatch(
            /\.category-page\s*\{[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;[^}]*overflow:\s*hidden;/,
        );
        expect(stylesheet).toMatch(/\.category-layout\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/);
        expect(stylesheet).toMatch(
            /\.category-results\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;/,
        );
        expect(stylesheet).toMatch(
            /\.category-subcat-sidebar\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;/,
        );
        expect(categoryPageSource).not.toContain('useScrollDirectionVisibility');
        expect(categoryPageSource).not.toContain('is-scroll-hidden');
        expect(presetStylesheet).not.toContain('.sort-bar.is-scroll-hidden');
    });

    it('uses a compact vertical All entry to expand categories without a duplicate all-products item', () => {
        expect(categoryPageSource).not.toContain('primary-categories-all-icon');
        expect(categoryPageSource).not.toContain("onCollectionChange('all', 'all')");
        expect(categoryPageSource).toContain('aria-controls="all-primary-categories"');
        expect(categoryPageSource).toContain('aria-expanded={allCategoriesOpen}');
        expect(stylesheet).toMatch(
            /\.category-page \.primary-categories-all\s*\{[^}]*width:\s*36px;[^}]*position:\s*absolute;[^}]*right:\s*calc\(-1 \* var\(--page-section-inset, 8px\)\);/,
        );
        expect(stylesheet).toMatch(
            /\.category-page \.primary-categories-all-label\s*\{[^}]*writing-mode:\s*vertical-rl;/,
        );
    });

    it('removes the secondary All count and keeps the sort choices on the product surface', () => {
        expect(categoryPageSource).not.toContain('subcat-side-all');
        expect(categoryPageSource).not.toContain('subcat-side-count');
        expect(categoryPageSource).not.toContain("{isZh ? '综合' : 'Default'}");
        expect(stylesheet).toMatch(
            /\.category-page \.category-results \.sort-bar\s*\{[^}]*border-radius:\s*0;[^}]*background:\s*var\(--category-results-surface\);/,
        );
    });

    it('aligns mobile search and primary navigation with a compact shared inset', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*1023px\)[\s\S]*?\.category-navigation-shell\s*\{[^}]*--page-section-inset:\s*8px;/,
        );
        expect(stylesheet).toMatch(
            /\.category-navigation-shell > \.topbar\.category-topbar\s*\{[^}]*height:\s*60px;[^}]*padding:\s*12px var\(--page-section-inset, 16px\);/,
        );
        expect(stylesheet).toMatch(
            /\.category-page \.primary-category-strip\s*\{[^}]*margin:\s*0 var\(--page-section-inset, 16px\);/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-results \.sort-bar\s*\{[^}]*margin:\s*0 var\(--page-section-inset, 16px\);/,
        );
        expect(stylesheet).toMatch(
            /\.category-product-list\s*\{[^}]*padding:\s*8px var\(--page-section-inset, 10px\) 12px;/,
        );
    });

    it('centers the sorting row within its own balanced section', () => {
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-results \.sort-bar\s*\{[^}]*height:\s*44px;[^}]*margin:\s*0 var\(--page-section-inset, 16px\);[^}]*align-items:\s*center;/,
        );
        expect(stylesheet).toMatch(/\.category-page \.category-product-list\s*\{[^}]*padding-top:\s*0;/);
    });

    it('distinguishes the active mobile subcategory without decorative dividers', () => {
        const layoutRule = stylesheet.match(/\.category-layout\s*\{([^}]*)\}/)?.[1] ?? '';
        const sidebarRule = stylesheet.match(/\.category-subcat-sidebar\s*\{([^}]*)\}/)?.[1] ?? '';
        const itemRule = stylesheet.match(/\.subcat-side-item\s*\{([^}]*)\}/)?.[1] ?? '';
        const activeItemRule = stylesheet.match(/\.subcat-side-item\.is-active\s*\{([^}]*)\}/)?.[1] ?? '';
        const resultsRule = stylesheet.match(/\.category-results\s*\{([^}]*)\}/)?.[1] ?? '';

        expect(layoutRule).toMatch(/--category-results-surface:\s*var\(--bg\);/);
        expect(sidebarRule).toMatch(/background:\s*var\(--soft\);/);
        expect(sidebarRule).toMatch(/border-right:\s*0;/);
        expect(itemRule).not.toMatch(/border-left/);
        expect(activeItemRule).toMatch(/background:\s*var\(--category-results-surface\);/);
        expect(activeItemRule).toMatch(/color:\s*var\(--text\);/);
        expect(activeItemRule).toMatch(/box-shadow:\s*none;/);
        expect(resultsRule).toMatch(/background:\s*var\(--category-results-surface\);/);
    });

    it('keeps the search bar full width on narrow mobile screens', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*370px\)[\s\S]*?\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*0;/,
        );
    });

    it('allows expanded English category names to grow without clipping', () => {
        expect(stylesheet).toMatch(
            /html\[lang='en'\] \.primary-category-label\s*\{[^}]*height:\s*48px;[^}]*white-space:\s*normal;[^}]*-webkit-line-clamp:\s*4;/,
        );
        expect(stylesheet).toMatch(
            /html\[lang='en'\] \.all-primary-category-grid button > span:last-child\s*\{[^}]*min-height:\s*60px;[^}]*display:\s*block;[^}]*white-space:\s*normal;/,
        );
        expect(stylesheet).toMatch(
            /html\[lang='en'\] \.primary-categories button\s*\{[^}]*width:\s*80px;[^}]*min-width:\s*80px;[^}]*height:\s*92px;/,
        );
    });

    it('allows complete category labels without stretching sparse navigation items', () => {
        expect(stylesheet).toMatch(
            /\.category-page \.primary-category-label\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;[^}]*white-space:\s*normal;/,
        );
        expect(stylesheet).toMatch(
            /\.primary-categories button\s*\{[^}]*width:\s*76px;[^}]*min-width:\s*76px;[^}]*max-width:\s*76px;/,
        );
        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- This single rule is the shared mobile gutter contract.
            /@media \(max-width:\s*1023px\)[\s\S]*?\.category-page \.primary-category-strip\s*\{[^}]*margin-inline:\s*var\(--page-section-inset, 16px\);[^}]*padding-inline:\s*0;/,
        );
        expect(stylesheet).toMatch(
            /\.category-page \.primary-category-strip \.primary-categories button\s*\{[^}]*width:\s*72px;[^}]*flex:\s*0 0 72px;/,
        );
        expect(categoryPageSource).not.toContain('--primary-category-visible-slots');
        expect(stylesheet).toMatch(/\.primary-category-image\s*\{[^}]*width:\s*48px;[^}]*height:\s*48px;/);
        expect(stylesheet).toMatch(/\.primary-categories button\s*\{[^}]*gap:\s*2px;/);
    });

    it('keeps the active category image inside the navigation row', () => {
        expect(stylesheet).toMatch(
            /\.primary-categories button\.is-active \.primary-category-image\s*\{[^}]*box-shadow:\s*none;[^}]*background:\s*var\(--accent-soft\);/,
        );
        expect(stylesheet).not.toMatch(
            /\.primary-categories button\.is-active \.primary-category-image\s*\{[^}]*transform:\s*translateY\(-/,
        );
    });
});

describe('routePageIdentity for category navigation transitions', () => {
    it('normalizes in-page category switches to a stable page identity', () => {
        expect(routePageIdentity({ name: 'category' })).toBe('category');
        expect(routePageIdentity({ name: 'category', collectionId: 'cat-baijiu' })).toBe('category');
        expect(
            routePageIdentity({
                name: 'category',
                collectionId: 'cat-coffee',
                childId: 'sub-instant',
                sort: 'price-asc',
                fulfillment: 'physical',
                inStockOnly: true,
                minPrice: '10',
                maxPrice: '100',
            }),
        ).toBe('category');
    });

    it('differentiates distinct whole-page destinations', () => {
        expect(routePageIdentity({ name: 'home' })).toBe('home');
        expect(routePageIdentity({ name: 'category' })).toBe('category');
        expect(routePageIdentity({ name: 'services' })).toBe('services');
        expect(routePageIdentity({ name: 'cart' })).toBe('cart');
        expect(routePageIdentity({ name: 'account' })).toBe('account');
        expect(routePageIdentity({ name: 'product', id: 'prod-1' })).toBe('product:prod-1');
        expect(routePageIdentity({ name: 'product', id: 'prod-2' })).toBe('product:prod-2');
        expect(routePageIdentity({ name: 'order-detail', id: 'ord-1' })).toBe('order-detail:ord-1');
        expect(routePageIdentity({ name: 'legal', id: 'privacy' })).toBe('legal:privacy');
    });
});
