import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStorefrontStylesheet } from './test-stylesheet';

import { categoryTargetSelection, centeredHorizontalScrollLeft } from './category-navigation';

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
                    '[^}]*padding-inline:\\s*var\\(--client-plugin-slot-inline-space\\);',
            ),
        );
        expect(stylesheet).not.toMatch(
            /\.category-client-plugin-slot\.is-[^{]+\{[^}]*(?:padding-top|padding-bottom):/,
        );
        expect(stylesheet).toMatch(
            /\.business-services-page \.category-client-plugin-slot\s*\{[^}]*--client-plugin-slot-block-space:\s*10px;[^}]*--client-plugin-slot-inline-space:\s*12px;/,
        );
    });

    it('uses a polished full-width search bar for the category header', () => {
        expect(categoryPageSource).not.toContain('category-title-lockup');
        expect(categoryPageSource).not.toContain("{isZh ? '选购商品' : 'Shop'}");
        expect(stylesheet).toMatch(
            /\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*padding-inline:\s*12px;/,
        );
        expect(stylesheet).toMatch(
            /\.search-trigger\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*box-shadow:/,
        );
        expect(stylesheet).toMatch(
            /\.category-topbar > \.search-trigger\s*\{[^}]*width:\s*100%;[^}]*height:\s*44px;/,
        );
        expect(stylesheet).toMatch(
            /@media \(min-width:\s*600px\)[\s\S]*?\.category-topbar\s*\{[^}]*height:\s*128px;[^}]*padding:\s*72px 24px 12px;/,
        );
    });

    it('keeps the desktop navigation stack and content height calculations aligned', () => {
        expect(stylesheet).toMatch(/\.category-page\s*\{[^}]*--category-content-sticky-top:\s*209px;/);
        expect(stylesheet).toMatch(/\.primary-category-switcher\s*\{[^}]*height:\s*80px;/);
        expect(
            stylesheet.match(/min-height:\s*calc\(100dvh - var\(--category-content-sticky-top\)\);/g),
        ).toHaveLength(3);
    });

    it('aligns the mobile all-category row with the sort toolbar', () => {
        expect(stylesheet).toMatch(
            /\.category-subcat-sidebar\s*\{[^}]*padding:\s*0 0 calc\(var\(--bottom-navigation-height, 66px\) \+ 24px\);/,
        );
        expect(stylesheet).toMatch(
            /\.subcat-side-all\s*\{[^}]*height:\s*38px;[^}]*min-height:\s*38px;[^}]*padding-block:\s*0;[^}]*flex-shrink:\s*0;/,
        );
        expect(stylesheet).toMatch(/\.category-results \.sort-bar\s*\{[^}]*height:\s*38px;/);
    });

    it('keeps the search bar full width on narrow mobile screens', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*370px\)[\s\S]*?\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*0;/,
        );
    });
});
