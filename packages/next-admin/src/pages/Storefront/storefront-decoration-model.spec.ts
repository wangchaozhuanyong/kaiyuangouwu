import { describe, expect, it } from 'vitest';
import { newContentBlock } from './storefront-content-utils';
import { applyDecorationDraft, decorationDraft, isReadOnlyPreviewQuery } from './storefront-decoration-model';

describe('decoration drafts follow the Shop publication contract', () => {
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
