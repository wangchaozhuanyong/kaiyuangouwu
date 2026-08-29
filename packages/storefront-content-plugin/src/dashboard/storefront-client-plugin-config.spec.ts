import { describe, expect, it } from 'vitest';

import {
    addClientPlugin,
    clientPluginBlockInput,
    clientPluginCatalog,
    clientPluginDraftIsValid,
    clientPluginPlacement,
    createClientPluginDraft,
    moveClientPlugin,
    placeClientPlugin,
    removeClientPlugin,
    targetClientPluginCategories,
} from './storefront-client-plugin-config';

describe('storefront client plugin configuration', () => {
    it('publishes the customer-facing 2FA tool in the platform catalog', () => {
        expect(clientPluginCatalog).toContainEqual(
            expect.objectContaining({
                code: 'two-factor-code-tool',
                defaultPlacement: 'BUSINESS_SERVICES_MAIN',
            }),
        );
    });

    it('creates an empty valid category plugin layout', () => {
        const draft = createClientPluginDraft();

        expect(draft).toMatchObject({
            code: 'storefront-client-plugins',
            type: 'CLIENT_PLUGINS',
            enabled: true,
            items: [],
        });
        expect(clientPluginDraftIsValid(draft)).toBe(true);
    });

    it('adds, places, orders and removes platform plugins', () => {
        let draft = createClientPluginDraft();
        draft = addClientPlugin(draft, clientPluginCatalog[0]);
        draft = addClientPlugin(draft, clientPluginCatalog[1]);
        draft = addClientPlugin(draft, clientPluginCatalog[0]);

        expect(draft.items).toHaveLength(2);
        draft = placeClientPlugin(draft, clientPluginCatalog[0].code, 'AFTER_HEADER');
        expect(clientPluginPlacement(draft.items[0])).toBe('AFTER_HEADER');

        draft = moveClientPlugin(draft, 1, 0);
        expect(draft.items.map(item => item.settings?.pluginCode)).toEqual([
            'category-support-entry',
            'category-coupon-entry',
        ]);

        draft = removeClientPlugin(draft, 'category-support-entry');
        expect(draft.items.map(item => item.position)).toEqual([0]);
        expect(clientPluginDraftIsValid(draft)).toBe(true);
    });

    it('serializes plugins as non-linking content items', () => {
        const draft = addClientPlugin(createClientPluginDraft(), clientPluginCatalog[0]);
        const input = clientPluginBlockInput(draft);

        expect(input.items[0]).toMatchObject({
            enabled: true,
            position: 0,
            targetType: 'NONE',
            targetValue: null,
            settings: {
                pluginCode: 'category-coupon-entry',
                placement: 'BEFORE_PRODUCT_LIST',
            },
        });
        expect(input.items[0].translations.map(translation => translation.languageCode)).toEqual([
            'zh_Hans',
            'en',
        ]);
    });

    it('keeps existing plugins global and validates selected category targeting', () => {
        let draft = addClientPlugin(createClientPluginDraft(), clientPluginCatalog[0]);
        expect(draft.items[0].settings).toMatchObject({
            categoryScope: 'ALL',
            categoryIds: [],
            includeChildren: true,
        });

        draft = targetClientPluginCategories(draft, clientPluginCatalog[0].code, {
            scope: 'SELECTED',
            categoryIds: [],
            includeChildren: true,
        });
        expect(clientPluginDraftIsValid(draft)).toBe(false);

        draft = placeClientPlugin(draft, clientPluginCatalog[0].code, 'BUSINESS_SERVICES_MAIN');
        expect(clientPluginDraftIsValid(draft)).toBe(true);

        draft = targetClientPluginCategories(draft, clientPluginCatalog[0].code, {
            scope: 'SELECTED',
            categoryIds: ['collection-1', 'collection-2'],
            includeChildren: false,
        });
        expect(clientPluginDraftIsValid(draft)).toBe(true);
        expect(clientPluginBlockInput(draft).items[0].settings).toMatchObject({
            categoryScope: 'SELECTED',
            categoryIds: ['collection-1', 'collection-2'],
            includeChildren: false,
        });
    });
});
