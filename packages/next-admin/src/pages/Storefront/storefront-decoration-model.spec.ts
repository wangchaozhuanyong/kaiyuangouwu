import { describe, expect, it } from 'vitest';

import { heroContentForViewport } from '../../../../storefront-content-plugin/src/shared/hero-image';

import { newContentBlock } from './storefront-content-utils';
import {
    applyDecorationDraft,
    applyDecorationDraftSettings,
    decorationDraft,
    isReadOnlyPreviewQuery,
    previewQueryCurrencyCode,
} from './storefront-decoration-model';

describe('decoration drafts follow the Shop publication contract', () => {
    it.each(['zh_Hans', 'en'] as const)(
        'marks an unsaved disabled footer configured for %s without changing other stores or module fallbacks',
        language => {
            const footer = newContentBlock('FOOTER', 130);
            footer.enabled = false;
            const draft = decorationDraft(footer, language);
            const source = { configuredBlockTypes: ['NOTICE' as const], heroAutoplayIntervalSeconds: 8 };
            const merged = applyDecorationDraftSettings(source, draft);
            expect(merged.configuredBlockTypes).toEqual(['NOTICE', 'FOOTER']);
            expect(source.configuredBlockTypes).toEqual(['NOTICE']);
            expect(merged.heroAutoplayIntervalSeconds).toBe(8);
            expect(applyDecorationDraftSettings(merged, draft)).toBe(merged);
            expect(
                applyDecorationDraftSettings(source, decorationDraft(newContentBlock('LEGAL', 0), language)),
            ).toBe(source);
            expect(applyDecorationDraftSettings({}, draft)).toEqual({ configuredBlockTypes: ['FOOTER'] });
        },
    );
    it('previews a footer with a blank brand and ordered enabled links, independent of legal content', () => {
        const footer = newContentBlock('FOOTER', 130);
        footer.items.reverse();
        footer.items.forEach((item, position) => {
            item.position = position;
        });
        footer.items[1].enabled = false;
        const draft = decorationDraft(footer, 'en');
        expect(draft).toMatchObject({ visible: true, route: '/', language: 'en' });
        expect(draft.block).toMatchObject({ type: 'FOOTER', title: '' });
        expect(draft.block?.items.map(item => item.label)).toEqual(['Terms of use']);
        footer.enabled = false;
        expect(decorationDraft(footer, 'zh_Hans').visible).toBe(false);
        footer.enabled = true;
        footer.items = [];
        expect(decorationDraft(footer, 'zh_Hans')).toMatchObject({ visible: true, block: { items: [] } });
    });
    it('passes the notice display period to the client preview with existing settings', () => {
        const block = newContentBlock('NOTICE', 0);
        block.enabled = true;
        block.settings = {
            announcementDisplayPeriod: '2_YEARS',
            scrollIntervalSeconds: 8,
            merchantSetting: 'retain',
        };
        expect(decorationDraft(block, 'zh_Hans').block?.settings).toEqual(block.settings);
    });

    it('opens the homepage with the configured asset and preserves neighbouring content', () => {
        const block = newContentBlock('HERO', 0, '主视觉');
        block.code = 'homepage-hero-under-test';
        block.enabled = true;
        block.imageAsset = {
            id: 'homepage-art',
            name: 'homepage.png',
            preview: '/assets/homepage.png',
            source: '/assets/homepage.png',
            width: 1200,
            height: 600,
        };
        const draft = decorationDraft(block, 'zh_Hans');
        expect(draft.route).toBe('/');
        expect(draft.visible).toBe(true);
        expect(draft.block).toMatchObject({
            code: block.code,
            imageUrl: '/assets/homepage.png',
            imageAsset: { width: 1200, height: 600 },
        });
        const neighbouringBlock = newContentBlock('HERO', 1, '首页');
        neighbouringBlock.code = 'homepage-hero-neighbour';
        neighbouringBlock.enabled = true;
        const neighbour = decorationDraft(neighbouringBlock, 'zh_Hans').block;
        if (!neighbour) throw new Error('Missing homepage fixture');
        expect(applyDecorationDraft([neighbour], draft)).toEqual([draft.block, neighbour]);
    });
    it('uses public Asset URLs, dimensions, selected language and only enabled items', () => {
        const block = newContentBlock('HERO', 2, '横幅');
        block.id = 'hero';
        block.enabled = true;
        block.imageAsset = {
            id: 'asset',
            name: 'asset',
            mimeType: 'image/png',
            preview: 'https://shop.example/assets/preview/banner.png',
            source: '/assets/source/banner.png',
            width: 1600,
            height: 520,
        };
        block.translations[1].title = 'Draft banner';
        const disabled = { ...newContentBlock('QUICK_LINKS', 0, '入口').items[0], enabled: false };
        block.items = [disabled];
        const draft = decorationDraft(block, 'en');
        expect(draft.visible).toBe(true);
        expect(draft.block).toMatchObject({
            title: 'Draft banner',
            imageUrl: '/assets/preview/banner.png',
            imageAsset: { width: 1600, height: 520 },
            items: [],
        });
    });

    it('carries phone artwork, per-language copy and colors through the real client draft without changing desktop copy', () => {
        const block = newContentBlock('HERO', 0, '手机专图');
        block.imageUrl = '/assets/desktop.webp';
        block.settings = {
            mobileImageUrl: '/assets/phone.webp',
            mobileImageAssetId: 'phone',
            mobileImageWidth: 1200,
            mobileImageHeight: 900,
            mobileHeroTextColor: '#292d32',
            mobileHeroSecondaryTextColor: '#454b52',
            mobileHeroTranslations: [
                {
                    languageCode: 'zh_Hans',
                    title: '简短中文',
                    subtitle: '',
                    body: '手机说明',
                    ctaLabel: '浏览',
                },
                {
                    languageCode: 'en',
                    title: 'Phone copy',
                    subtitle: '',
                    body: 'Short copy',
                    ctaLabel: 'Browse',
                },
            ],
        };
        for (const [language, clientLanguage, expectedTitle] of [
            ['zh_Hans', 'zh', '简短中文'],
            ['en', 'en', 'Phone copy'],
        ] as const) {
            const draft = decorationDraft(block, language).block;
            if (!draft) throw new Error('Expected a phone hero draft');
            expect(draft.settings).toEqual(block.settings);
            expect(heroContentForViewport(draft, false, clientLanguage)).toMatchObject({
                imageUrl: '/assets/phone.webp',
                imageAsset: { width: 1200, height: 900 },
                title: expectedTitle,
                subtitle: '',
                textColor: '#292d32',
                settings: { secondaryTextColor: '#454b52' },
            });
            expect(heroContentForViewport(draft, true, clientLanguage)).toBe(draft);
            expect(draft.title).toBe(
                block.translations.find(translation => translation.languageCode === language)?.title,
            );
        }
    });

    it('replaces a saved block, removes unpublished drafts and leaves neighbouring content intact', () => {
        const block = newContentBlock('STORY', 2, '品牌故事');
        block.id = 'story';
        block.enabled = true;
        const before = decorationDraft(newContentBlock('NOTICE', 0, '公告'), 'zh_Hans').block!;
        const draft = decorationDraft(block, 'zh_Hans');
        const blocks = [before, { ...draft.block!, title: '旧文案' }];
        expect(applyDecorationDraft(blocks, draft)).toEqual([before, draft.block]);
        block.enabled = false;
        expect(applyDecorationDraft(blocks, decorationDraft(block, 'zh_Hans'))).toEqual([before]);
        block.enabled = true;
        block.startsAt = '2999-01-01T00:00:00Z';
        expect(decorationDraft(block, 'zh_Hans').visible).toBe(false);
        expect(
            applyDecorationDraft(blocks, { block: null, route: '/', language: 'zh', visible: false }),
        ).toBe(blocks);
    });

    it('opens the shared services route for managed service copy without moving legacy category plugin previews', () => {
        const block = newContentBlock('CLIENT_PLUGINS', 10_001, 'Services');
        expect(decorationDraft(block, 'zh_Hans').route).toBe('/category');
        block.settings = { ...block.settings, businessServicesCopyVersion: 1 };
        expect(decorationDraft(block, 'zh_Hans').route).toBe('/services');
        expect(decorationDraft(block, 'en').route).toBe('/services');
    });

    it('opens real support, authentication and business services pages', () => {
        for (const [type, route] of [
            ['SUPPORT', '/support'],
            ['AUTH_LOGIN', '/login'],
            ['AUTH_REGISTER', '/register'],
            ['CLIENT_PLUGINS', '/category'],
        ] as const) {
            expect(decorationDraft(newContentBlock(type, 0, type), 'zh_Hans').route).toBe(route);
        }
    });
});

describe('preview network requests are read only', () => {
    it('accepts a single query with fragments and rejects writes, mixed operations and malformed documents', () => {
        expect(
            isReadOnlyPreviewQuery(
                'query Read { activeChannel { ...Fields } } fragment Fields on Channel { id }',
            ),
        ).toBe(true);
        expect(isReadOnlyPreviewQuery('{ activeChannel { id } }')).toBe(true);
        for (const query of [
            'mutation Save { addItemToOrder { id } }',
            'query Read { activeChannel { id } } mutation Save { logout { success } }',
            'subscription Changes { channel { id } }',
            'fragment Fields on Channel { id }',
            'not graphql',
        ])
            expect(isReadOnlyPreviewQuery(query)).toBe(false);
    });
});

it('resolves store configuration before applying a preview currency preference', () => {
    expect(
        previewQueryCurrencyCode('query StorefrontConfig { activeChannel { code } }', 'CNY'),
    ).toBeUndefined();
    expect(previewQueryCurrencyCode('query Prices { products { items { id } } }', 'MYR')).toBe('MYR');
    expect(previewQueryCurrencyCode('query Prices { products { items { id } } }', 'invalid')).toBeUndefined();
});
