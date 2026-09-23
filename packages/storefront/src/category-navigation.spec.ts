import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    categoryTargetSelection,
    centeredHorizontalScrollLeft,
    compactCategoryLabel,
} from './category-navigation';
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

describe('category navigation labels', () => {
    it('keeps at most six visible Chinese characters while preserving short labels', () => {
        expect(compactCategoryLabel('正品烟草')).toBe('正品烟草');
        expect(compactCategoryLabel('马来西亚特色食品')).toBe('马来西亚特色');
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

    it('uses the connected search treatment without a duplicate visible title', () => {
        expect(categoryPageSource).not.toContain('category-title-lockup');
        expect(categoryPageSource).not.toContain('category-mobile-heading');
        expect(categoryPageSource).not.toContain("{isZh ? '选购商品' : 'Shop'}");
        expect(stylesheet).toMatch(
            /\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*padding-inline:\s*16px;/,
        );
        expect(stylesheet).toMatch(
            /\.category-topbar > \.search-trigger\s*\{[^}]*padding:\s*0;[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*none;/,
        );
        expect(stylesheet).toMatch(
            /\.category-topbar \.search-trigger-action\s*\{[^}]*height:\s*auto;[^}]*align-self:\s*stretch;[^}]*border-radius:\s*0;/,
        );
        expect(stylesheet).toMatch(
            /\.category-topbar > \.search-trigger\s*\{[^}]*width:\s*100%;[^}]*height:\s*44px;/,
        );
        expect(stylesheet).toMatch(
            /@media \(min-width:\s*600px\)[\s\S]*?\.category-topbar\s*\{[^}]*height:\s*128px;[^}]*padding:\s*72px 24px 12px;/,
        );
    });

    it('keeps the desktop primary navigation height aligned', () => {
        expect(stylesheet).toMatch(/\.category-page\s*\{[^}]*--category-content-sticky-top:\s*209px;/);
        expect(stylesheet).toMatch(/\.primary-category-switcher\s*\{[^}]*height:\s*80px;/);
    });

    it('uses the page viewport for mobile catalog scrolling instead of a nested product scrollbar', () => {
        expect(stylesheet).toMatch(
            /\.category-page\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/,
        );
        expect(stylesheet).toMatch(/\.category-layout\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/);
        expect(stylesheet).toMatch(
            /\.category-results\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/,
        );
    });

    it('balances the primary category row and uses a category-list symbol for the all entry', () => {
        expect(stylesheet).toMatch(/\.primary-category-strip\s*\{[^}]*height:\s*70px;[^}]*padding:\s*0;/);
        expect(stylesheet).toMatch(/\.primary-categories\s*\{[^}]*padding:\s*0 4px 0 10px;/);
        expect(stylesheet).toMatch(/\.primary-categories-all\s*\{[^}]*padding:\s*0 4px 0 0;/);
        expect(stylesheet).toMatch(
            /@media \(min-width:\s*1024px\)[\s\S]*?\.primary-category-strip\s*\{[^}]*height:\s*79px;[^}]*padding-block:\s*0 11px;/,
        );
        expect(categoryPageSource).toContain('<svg viewBox="0 0 40 40" fill="none">');
        expect(categoryPageSource).not.toContain('allCategoriesGoldIcon');
        expect(stylesheet).toMatch(
            /\.primary-categories-all-icon\s*\{[^}]*border:\s*1px solid color-mix\([^}]*color:\s*var\(--accent\);/,
        );
        expect(stylesheet).toMatch(
            /\.category-page \.primary-category-strip\s*\{[^}]*margin:\s*4px var\(--page-section-inset, 16px\) 8px;[^}]*gap:\s*0;/,
        );
        expect(stylesheet).toMatch(
            /\.category-page \.primary-categories-all\s*\{[^}]*width:\s*56px;[^}]*min-width:\s*56px;[^}]*flex:\s*0 0 56px;/,
        );
    });

    it('aligns the mobile all-category row with the sort toolbar', () => {
        expect(stylesheet).toMatch(/\.category-subcat-sidebar\s*\{[^}]*padding:\s*0 0 12px;/);
        expect(stylesheet).toMatch(
            /\.subcat-side-all\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;[^}]*padding-block:\s*0;[^}]*flex-shrink:\s*0;/,
        );
        expect(stylesheet).toMatch(/\.category-results \.sort-bar\s*\{[^}]*height:\s*44px;/);
    });

    it('aligns mobile search, primary navigation, sorting and product rows to one inset', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*1023px\)[\s\S]*?\.category-page\s*\{[^}]*--page-section-inset:\s*16px;/,
        );
        expect(stylesheet).toMatch(
            /\.category-navigation-shell > \.topbar\.category-topbar\s*\{[^}]*padding:\s*12px var\(--page-section-inset, 16px\);/,
        );
        expect(stylesheet).toMatch(
            /\.category-page \.primary-category-strip\s*\{[^}]*margin:\s*4px var\(--page-section-inset, 16px\) 8px;/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-results \.sort-bar\s*\{[^}]*margin:\s*8px var\(--page-section-inset, 16px\) 0;/,
        );
        expect(stylesheet).toMatch(
            /\.category-product-list\s*\{[^}]*padding:\s*8px var\(--page-section-inset, 10px\) 12px;/,
        );
    });

    it('keeps equal space above and below the mobile sorting surface', () => {
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-results \.sort-bar\s*\{[^}]*margin:\s*8px var\(--page-section-inset, 16px\) 0;/,
        );
        expect(stylesheet).toMatch(
            /\.category-product-list\s*\{[^}]*padding:\s*8px var\(--page-section-inset, 10px\) 12px;/,
        );
    });

    it('connects the active mobile subcategory to the product area without vertical dividers', () => {
        const layoutRule = stylesheet.match(/\.category-layout\s*\{([^}]*)\}/)?.[1] ?? '';
        const sidebarRule = stylesheet.match(/\.category-subcat-sidebar\s*\{([^}]*)\}/)?.[1] ?? '';
        const itemRule = stylesheet.match(/\.subcat-side-item\s*\{([^}]*)\}/)?.[1] ?? '';
        const activeItemRule = stylesheet.match(/\.subcat-side-item\.is-active\s*\{([^}]*)\}/)?.[1] ?? '';
        const resultsRule = stylesheet.match(/\.category-results\s*\{([^}]*)\}/)?.[1] ?? '';

        expect(layoutRule).toMatch(/--category-results-surface:\s*var\(--surface\);/);
        expect(sidebarRule).toMatch(/border-right:\s*0;/);
        expect(itemRule).not.toMatch(/border-left/);
        expect(activeItemRule).toMatch(/background:\s*var\(--category-results-surface\);/);
        expect(activeItemRule).toMatch(/color:\s*var\(--accent-ink\);/);
        expect(activeItemRule).toMatch(/box-shadow:\s*1px 0 0 var\(--category-results-surface\);/);
        expect(resultsRule).toMatch(/background:\s*var\(--category-results-surface\);/);
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-layout\s*\{[^}]*--category-results-surface:\s*var\(--bg\);/,
        );
    });

    it('uses the product row as the only mobile catalog frame', () => {
        expect(presetStylesheet).toMatch(
            // eslint-disable-next-line max-len -- This single rule is the mobile product-frame contract.
            /\.category-page \.category-product-list \.product-row\s*\{[^}]*min-height:\s*96px;[^}]*padding:\s*0;[^}]*overflow:\s*hidden;[^}]*border-radius:\s*var\(--radius-md\);/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-product-list \.product-row-image\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*96px;[^}]*border:\s*0;[^}]*border-radius:\s*0;/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-page\s+\.category-product-list\s+\.product-row-image\s+:is\(\.responsive-picture, img, \.image-placeholder\)\s*\{[^}]*border-radius:\s*0;/,
        );
        expect(presetStylesheet).toMatch(
            /\.category-page \.category-product-list \.product-row-content\s*\{[^}]*padding:\s*8px 10px 8px 0;/,
        );
    });

    it('keeps the search bar full width on narrow mobile screens', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*370px\)[\s\S]*?\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*0;/,
        );
    });

    it('allows long English category labels to wrap without changing Chinese labels', () => {
        expect(stylesheet).toMatch(
            /html\[lang='en'\] \.primary-category-label\s*\{[^}]*height:\s*48px;[^}]*white-space:\s*normal;[^}]*-webkit-line-clamp:\s*4;/,
        );
        expect(stylesheet).toMatch(
            /html\[lang='en'\] \.all-primary-category-grid button > span:last-child\s*\{[^}]*min-height:\s*60px;[^}]*white-space:\s*normal;[^}]*-webkit-line-clamp:\s*4;/,
        );
        expect(stylesheet).toMatch(
            /html\[lang='en'\] \.primary-categories button\s*\{[^}]*width:\s*80px;[^}]*min-width:\s*80px;[^}]*height:\s*92px;/,
        );
    });

    it('keeps Chinese labels single-line and balances the visible mobile navigation slots', () => {
        const mobileChineseCategoryPrefix =
            String.raw`@media \(max-width:\s*1023px\)[\s\S]*?` +
            String.raw`html:not\(\[lang='en'\]\) \.category-page `;

        expect(stylesheet).toMatch(
            /\.primary-category-label\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/,
        );
        expect(stylesheet).toMatch(
            /\.primary-categories button\s*\{[^}]*width:\s*76px;[^}]*min-width:\s*76px;[^}]*max-width:\s*76px;/,
        );
        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- This single rule is the shared mobile gutter contract.
            /@media \(max-width:\s*1023px\)[\s\S]*?\.category-page \.primary-category-strip\s*\{[^}]*margin-inline:\s*var\(--page-section-inset, 16px\);[^}]*padding-inline:\s*0;/,
        );
        expect(stylesheet).toMatch(
            new RegExp(mobileChineseCategoryPrefix + String.raw`\.primary-category-strip\s*\{[^}]*gap:\s*0;`),
        );
        expect(stylesheet).toMatch(
            new RegExp(
                mobileChineseCategoryPrefix +
                    String.raw`\.primary-categories\s*\{[^}]*width:\s*auto;` +
                    String.raw`[^}]*flex:\s*var\(--primary-category-visible-slots, 4\) 1 0;[^}]*gap:\s*0;`,
            ),
        );
        expect(stylesheet).toMatch(
            new RegExp(
                mobileChineseCategoryPrefix +
                    String.raw`\.primary-category-strip \.primary-categories button\s*\{` +
                    String.raw`[^}]*width:\s*calc\(100% / var\(--primary-category-visible-slots, 4\)\);` +
                    String.raw`[^}]*min-width:\s*calc\(100% / var\(--primary-category-visible-slots, 4\)\);` +
                    String.raw`[^}]*max-width:\s*calc\(100% / var\(--primary-category-visible-slots, 4\)\);` +
                    String.raw`[^}]*flex:\s*0 0 calc\(100% / var\(--primary-category-visible-slots, 4\)\);`,
            ),
        );
        expect(stylesheet).toMatch(
            new RegExp(
                mobileChineseCategoryPrefix +
                    String.raw`\.primary-categories-all\s*\{[^}]*width:\s*auto;` +
                    String.raw`[^}]*min-width:\s*0;[^}]*flex:\s*1 1 0;`,
            ),
        );
        expect(categoryPageSource).toContain(
            "'--primary-category-visible-slots': Math.min(primaryCollections.length + 1, 4)",
        );
        expect(stylesheet).toMatch(/\.primary-category-image\s*\{[^}]*width:\s*48px;[^}]*height:\s*48px;/);
        expect(stylesheet).toMatch(/\.primary-categories button\s*\{[^}]*gap:\s*2px;/);
    });

    it('keeps the active category image inside the navigation row', () => {
        expect(stylesheet).toMatch(
            /\.primary-categories button\.is-active \.primary-category-image\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--accent\);[^}]*transform:\s*none;/,
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
