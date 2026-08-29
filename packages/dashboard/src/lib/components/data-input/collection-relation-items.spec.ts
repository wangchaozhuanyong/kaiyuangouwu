import { describe, expect, it } from 'vitest';

import {
    CollectionRelationItem,
    collectionRelationDepth,
    collectionRelationPath,
    compareCollectionRelationItems,
    isSelectableCollectionRelationItem,
} from './collection-relation-items.js';

const root = { id: 'root', name: '__root_collection__' };

function item(
    id: string,
    name: string,
    breadcrumbs: CollectionRelationItem['breadcrumbs'],
    position = 0,
    parent: CollectionRelationItem['parent'] = null,
): CollectionRelationItem {
    return { id, name, breadcrumbs, position, parent };
}

describe('collection relation hierarchy', () => {
    it('builds a readable path and level from the collection breadcrumbs', () => {
        const topLevel = item('ai', 'AI 服务', [root, { id: 'ai', name: 'AI 服务' }]);
        const child = item('chatgpt', 'ChatGPT', [
            root,
            { id: 'ai', name: 'AI 服务' },
            { id: 'chatgpt', name: 'ChatGPT' },
        ]);

        expect(collectionRelationDepth(topLevel)).toBe(1);
        expect(collectionRelationPath(topLevel)).toBe('AI 服务');
        expect(collectionRelationDepth(child)).toBe(2);
        expect(collectionRelationPath(child)).toBe('AI 服务 / ChatGPT');
    });

    it('keeps every child directly below its first-level category', () => {
        const collections = [
            item(
                'large',
                '大额充值',
                [root, { id: 'gateway', name: '中转站充值' }, { id: 'large', name: '大额充值' }],
                2,
                { id: 'gateway', name: '中转站充值', position: 0 },
            ),
            item('apple', 'Apple 账号', [root, { id: 'apple', name: 'Apple 账号' }], 1),
            item('gateway', '中转站充值', [root, { id: 'gateway', name: '中转站充值' }], 0),
            item(
                'small',
                '小额充值',
                [root, { id: 'gateway', name: '中转站充值' }, { id: 'small', name: '小额充值' }],
                1,
                { id: 'gateway', name: '中转站充值', position: 0 },
            ),
        ].sort(compareCollectionRelationItems);

        expect(collections.map(collectionRelationPath)).toEqual([
            '中转站充值',
            '中转站充值 / 小额充值',
            '中转站充值 / 大额充值',
            'Apple 账号',
        ]);
    });

    it('allows exactly first- and second-level categories', () => {
        const rootItem = item('root', 'root', [root]);
        const firstLevel = item('one', '一级', [root, { id: 'one', name: '一级' }]);
        const secondLevel = item('two', '二级', [
            root,
            { id: 'one', name: '一级' },
            { id: 'two', name: '二级' },
        ]);
        const thirdLevel = item('three', '三级', [
            root,
            { id: 'one', name: '一级' },
            { id: 'two', name: '二级' },
            { id: 'three', name: '三级' },
        ]);

        expect(isSelectableCollectionRelationItem(rootItem)).toBe(false);
        expect(isSelectableCollectionRelationItem(firstLevel)).toBe(true);
        expect(isSelectableCollectionRelationItem(secondLevel)).toBe(true);
        expect(isSelectableCollectionRelationItem(thirdLevel)).toBe(false);
    });
});
