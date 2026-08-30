import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
    const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const categoryPageSource = readFileSync(new URL('./pages/category-page.tsx', import.meta.url), 'utf8');

    it('keeps client plugin spacing symmetric at every insertion point', () => {
        const symmetricPluginSpacing = new RegExp(
            String.raw`\.category-client-plugin-slot\s*\{[^}]*` +
                String.raw`--client-plugin-slot-block-space:\s*8px;[^}]*` +
                String.raw`padding-block:\s*var\(--client-plugin-slot-block-space\);[^}]*` +
                String.raw`padding-inline:\s*var\(--client-plugin-slot-inline-space\);`,
        );
        expect(stylesheet).toMatch(symmetricPluginSpacing);
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
            /@media \(min-width:\s*640px\)[\s\S]*?\.category-topbar\s*\{[^}]*height:\s*128px;[^}]*padding:\s*72px 24px 12px;/,
        );
    });

    it('keeps the desktop navigation stack and content height calculations aligned', () => {
        expect(stylesheet).toMatch(/\.category-page\s*\{[^}]*--category-content-sticky-top:\s*209px;/);
        expect(stylesheet).toMatch(/\.primary-category-switcher\s*\{[^}]*height:\s*80px;/);
        expect(
            stylesheet.match(/min-height:\s*calc\(100dvh - var\(--category-content-sticky-top\)\);/g),
        ).toHaveLength(3);
    });

    it('keeps the search bar full width on narrow mobile screens', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*370px\)[\s\S]*?\.category-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*0;/,
        );
    });

    it('keeps every sidebar category action at the same height', () => {
        expect(stylesheet).toMatch(
            /\.subcat-side-item\s*\{[^}]*height:\s*48px;[^}]*min-height:\s*48px;[^}]*flex:\s*0 0 48px;/,
        );
        expect(stylesheet).toMatch(/\.subcat-side-all\.is-active\s*\{[^}]*box-shadow:\s*none;/);
    });
});
