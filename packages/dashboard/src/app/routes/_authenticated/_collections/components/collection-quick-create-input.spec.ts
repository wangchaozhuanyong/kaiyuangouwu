import { describe, expect, it } from 'vitest';

import { buildCollectionQuickCreateInput } from './collection-quick-create-input.js';

describe('buildCollectionQuickCreateInput', () => {
    it('always writes Simplified Chinese source content for a top-level category', () => {
        const input = buildCollectionQuickCreateInput({
            name: '  ChatGPT 订阅  ',
            isVisible: true,
        });

        expect(input).toMatchObject({
            parentId: undefined,
            isPrivate: false,
            filters: [],
            translations: [
                {
                    languageCode: 'zh_Hans',
                    name: 'ChatGPT 订阅',
                    slug: 'chatgpt-订阅',
                },
            ],
        });
    });

    it('creates a second-level category under the selected first-level category', () => {
        const input = buildCollectionQuickCreateInput({
            name: 'Plus 订阅',
            parentId: 'collection-1',
            isVisible: false,
            assetIds: ['asset-1'],
            featuredAssetId: 'asset-1',
        });

        expect(input).toMatchObject({
            parentId: 'collection-1',
            isPrivate: true,
            assetIds: ['asset-1'],
            featuredAssetId: 'asset-1',
        });
    });
});
