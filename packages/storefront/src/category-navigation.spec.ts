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

    it('uses one compact row for the desktop category header', () => {
        expect(stylesheet).toMatch(/\.category-topbar\s*\{[^}]*height:\s*72px;[^}]*padding:\s*0 32px;/);
        expect(stylesheet).toMatch(
            /\.category-topbar > \.search-trigger\s*\{[^}]*top:\s*14px;[^}]*right:\s*32px;[^}]*left:\s*calc\(50% \+ 226px\);/,
        );
    });

    it('keeps the desktop navigation stack and content height calculations aligned', () => {
        expect(stylesheet).toMatch(/\.category-page\s*\{[^}]*--category-content-sticky-top:\s*153px;/);
        expect(stylesheet).toMatch(/\.primary-category-switcher\s*\{[^}]*height:\s*80px;/);
        expect(
            stylesheet.match(/min-height:\s*calc\(100dvh - var\(--category-content-sticky-top\)\);/g),
        ).toHaveLength(3);
    });

    it('does not reserve an empty third column on narrow mobile screens', () => {
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*370px\)[\s\S]*?\.category-topbar\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\);[^}]*gap:\s*8px;/,
        );
    });

    it('keeps every sidebar category action at the same height', () => {
        expect(stylesheet).toMatch(
            /\.subcat-side-item\s*\{[^}]*height:\s*48px;[^}]*min-height:\s*48px;[^}]*flex:\s*0 0 48px;/,
        );
        expect(stylesheet).toMatch(/\.subcat-side-all\.is-active\s*\{[^}]*box-shadow:\s*none;/);
    });
});
