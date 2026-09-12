import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { categoryTargetSelection, centeredHorizontalScrollLeft } from './category-navigation';
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
            /\.business-services-page \.category-client-plugin-slot\s*\{[^}]*--client-plugin-slot-block-space:\s*10px;[^}]*--client-plugin-slot-inline-space:\s*12px;/,
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

    it('balances the primary category row and uses a category-list symbol for the all entry', () => {
        expect(stylesheet).toMatch(
            /\.primary-category-strip\s*\{[^}]*height:\s*81px;[^}]*padding:\s*0 0 12px;/,
        );
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
        expect(stylesheet).toMatch(/\.category-page \.primary-category-strip\s*\{[^}]*gap:\s*4px;/);
        expect(stylesheet).toMatch(
            /\.category-page \.primary-categories-all\s*\{[^}]*width:\s*72px;[^}]*min-width:\s*72px;[^}]*flex:\s*0 0 72px;/,
        );
    });

    it('aligns the mobile all-category row with the sort toolbar', () => {
        expect(stylesheet).toMatch(/\.category-subcat-sidebar\s*\{[^}]*padding:\s*0 0 12px;/);
        expect(stylesheet).toMatch(
            /\.subcat-side-all\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;[^}]*padding-block:\s*0;[^}]*flex-shrink:\s*0;/,
        );
        expect(stylesheet).toMatch(/\.category-results \.sort-bar\s*\{[^}]*height:\s*44px;/);
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
});
