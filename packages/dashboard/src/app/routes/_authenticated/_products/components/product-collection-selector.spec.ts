import { describe, expect, it } from 'vitest';

import {
    buildProductCollectionGroups,
    filterProductCollectionGroups,
    type ProductCollectionParent,
} from './product-collection-selector.js';

const parents: ProductCollectionParent[] = [
    {
        id: 'subscriptions',
        name: 'Subscriptions',
        slug: 'subscriptions',
        position: 2,
        children: [
            { id: 'gpt', name: 'GPT Plus', slug: 'gpt-plus', position: 2 },
            { id: 'claude', name: 'Claude Pro', slug: 'claude-pro', position: 1 },
        ],
    },
    {
        id: 'recharge',
        name: 'Recharge',
        slug: 'recharge',
        position: 1,
        children: [{ id: 'small', name: 'Small recharge', slug: 'small-recharge', position: 1 }],
    },
];

describe('product collection hierarchy', () => {
    it('sorts top-level and second-level collections by their configured position', () => {
        const groups = buildProductCollectionGroups(parents);

        expect(groups.map(group => group.parent.id)).toEqual(['recharge', 'subscriptions']);
        expect(groups[1]?.children.map(child => child.id)).toEqual(['claude', 'gpt']);
    });

    it('keeps all second-level collections when the top-level collection matches the search', () => {
        const groups = filterProductCollectionGroups(buildProductCollectionGroups(parents), 'subscription');

        expect(groups).toHaveLength(1);
        expect(groups[0]?.parent.id).toBe('subscriptions');
        expect(groups[0]?.children.map(child => child.id)).toEqual(['claude', 'gpt']);
    });

    it('keeps the top-level context when only a second-level collection matches the search', () => {
        const groups = filterProductCollectionGroups(buildProductCollectionGroups(parents), 'claude');

        expect(groups).toHaveLength(1);
        expect(groups[0]?.parent.id).toBe('subscriptions');
        expect(groups[0]?.children.map(child => child.id)).toEqual(['claude']);
    });
});
