import { describe, expect, it } from 'vitest';

import {
    BUSINESS_SERVICES_COPY_VERSION,
    addClientPlugin,
    clientPluginBlockInput,
    clientPluginCatalog,
    clientPluginDraftIsValid,
    clientPluginPageCopyIsValid,
    clientPluginPageCopyTranslation,
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
            settings: {
                businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
            },
            items: [],
        });
        expect(clientPluginPageCopyTranslation(draft, 'zh_Hans')).toMatchObject({
            title: '发现更多商业能力',
            body: '这里展示店铺为你开放的工具、服务和专属权益。',
        });
        expect(clientPluginPageCopyIsValid(draft)).toBe(true);
        expect(clientPluginDraftIsValid(draft)).toBe(true);
    });

    it('migrates the legacy internal block label to storefront page copy defaults', () => {
        const legacy = createClientPluginDraft();
        legacy.settings = { version: 1, page: 'category' };
        legacy.translations = legacy.translations.map(translation => ({
            ...translation,
            title: translation.languageCode === 'zh_Hans' ? '客户端插件配置' : 'Storefront client plugins',
            body: '',
        }));

        const migrated = createClientPluginDraft(legacy);

        expect(clientPluginPageCopyTranslation(migrated, 'zh_Hans').title).toBe('发现更多商业能力');
        expect(clientPluginPageCopyTranslation(migrated, 'en').body).toBe(
            'Explore tools, services, and benefits enabled by this store.',
        );
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
        expect(input.settings).toMatchObject({
            businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
        });
    });

    it('serializes customized business-services page copy', () => {
        const draft = createClientPluginDraft();
        draft.translations = draft.translations.map(translation =>
            translation.languageCode === 'zh_Hans'
                ? { ...translation, title: '更多服务', body: '选择适合你的店铺服务。' }
                : { ...translation, title: 'More services', body: 'Choose services for your store.' },
        );

        const input = clientPluginBlockInput(draft);

        expect(input.translations).toEqual([
            {
                languageCode: 'zh_Hans',
                title: '更多服务',
                subtitle: '',
                body: '选择适合你的店铺服务。',
                ctaLabel: '',
            },
            {
                languageCode: 'en',
                title: 'More services',
                subtitle: '',
                body: 'Choose services for your store.',
                ctaLabel: '',
            },
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
