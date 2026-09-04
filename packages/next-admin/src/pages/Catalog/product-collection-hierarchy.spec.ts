import { describe, expect, it } from 'vitest';

import { buildProductCollectionGroups, filterProductCollectionGroups } from './product-collection-hierarchy';
import type { CollectionItem } from './product-editor-types';

const collection = (
    id: string,
    name: string,
    slug: string,
    position: number,
    children: CollectionItem[] = [],
): CollectionItem => ({ id, name, slug, position, filters: [], children });

const collections = [
    collection('subscriptions', '订阅服务', 'subscriptions', 2, [
        collection('gpt', 'GPT 订阅', 'gpt-subscription', 2),
        collection('claude', 'Claude 订阅', 'claude-subscription', 1),
    ]),
    collection('recharge', '充值服务', 'recharge', 1, [collection('small', '小额充值', 'small-recharge', 1)]),
];

describe('product collection hierarchy', () => {
    it('sorts both category levels by their configured position', () => {
        const groups = buildProductCollectionGroups(collections);

        expect(groups.map(group => group.parent.id)).toEqual(['recharge', 'subscriptions']);
        expect(groups[1]?.children.map(child => child.id)).toEqual(['claude', 'gpt']);
    });

    it('keeps every second-level category when its first-level category matches', () => {
        const groups = filterProductCollectionGroups(
            buildProductCollectionGroups(collections),
            'subscriptions',
        );

        expect(groups).toHaveLength(1);
        expect(groups[0]?.parent.id).toBe('subscriptions');
        expect(groups[0]?.children.map(child => child.id)).toEqual(['claude', 'gpt']);
    });

    it('keeps the first-level context when a second-level name or slug matches', () => {
        const byName = filterProductCollectionGroups(buildProductCollectionGroups(collections), 'Claude');
        const bySlug = filterProductCollectionGroups(
            buildProductCollectionGroups(collections),
            'small-recharge',
        );

        expect(byName[0]?.parent.id).toBe('subscriptions');
        expect(byName[0]?.children.map(child => child.id)).toEqual(['claude']);
        expect(bySlug[0]?.parent.id).toBe('recharge');
        expect(bySlug[0]?.children.map(child => child.id)).toEqual(['small']);
    });
});
