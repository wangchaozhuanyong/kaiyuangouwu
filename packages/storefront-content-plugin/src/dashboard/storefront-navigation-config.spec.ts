import { describe, expect, it } from 'vitest';

import {
    MAX_NAVIGATION_ITEMS,
    createDefaultNavigationItems,
    createEmptyNavigationItem,
    createNavigationDraft,
    moveNavigationItem,
    navigationBlockInput,
    navigationDraftIsValid,
} from './storefront-navigation-config';

describe('storefront navigation configuration', () => {
    it('starts with business services between shop and cart', () => {
        const draft = createNavigationDraft();

        expect(draft.items.map(item => item.targetValue)).toEqual([
            '/',
            '/category',
            '/services',
            '/cart',
            '/account',
        ]);
        expect(navigationDraftIsValid(draft)).toBe(true);
    });

    it('reorders items and rewrites their persisted positions', () => {
        const reordered = moveNavigationItem(createDefaultNavigationItems(), 4, 1);

        expect(reordered.map(item => item.targetValue)).toEqual([
            '/',
            '/account',
            '/category',
            '/services',
            '/cart',
        ]);
        expect(reordered.map(item => item.position)).toEqual([0, 1, 2, 3, 4]);
    });

    it('rejects missing names and more than five items', () => {
        const draft = createNavigationDraft();
        draft.items[4] = createEmptyNavigationItem(4);
        expect(navigationDraftIsValid(draft)).toBe(false);

        draft.items[4].translations[0].label = '搜索';
        draft.items[4].targetValue = '/search';
        expect(navigationDraftIsValid(draft)).toBe(true);

        draft.items.push(createEmptyNavigationItem(MAX_NAVIGATION_ITEMS));
        expect(navigationDraftIsValid(draft)).toBe(false);
    });

    it('omits a removed icon URL so the backend clears the previous asset', () => {
        const draft = createNavigationDraft();
        draft.items[0] = {
            ...draft.items[0],
            id: 'item-1',
            imageAsset: null,
            imageAssetId: null,
            imageUrl: null,
        };

        expect(navigationBlockInput(draft).items[0]).toMatchObject({ imageAssetId: null });
        expect(navigationBlockInput(draft).items[0]).not.toHaveProperty('imageUrl');
    });
});
