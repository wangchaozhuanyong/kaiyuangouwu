import { describe, expect, it } from 'vitest';
import { productEditorDraft } from './product-editor-draft';
import type { ProductDetailRecord } from './product-editor-types';

const product: ProductDetailRecord = {
    id: 'p1',
    enabled: true,
    name: 'Translated name',
    slug: 'translated',
    description: '',
    translations: [
        { id: 't1', languageCode: 'zh_Hans', name: '源商品', slug: 'source', description: '源描述' },
    ],
    assets: [],
    optionGroups: [],
    facetValues: [],
    collections: [],
    channels: [],
    customFields: { fulfillmentType: 'physical', manualDeliverySlaMinutes: 1 },
    variants: [
        {
            id: 'v1',
            enabled: true,
            name: 'Variant',
            sku: 'SKU-1',
            price: 1299,
            stockOnHand: 8,
            stockAllocated: 2,
            trackInventory: 'TRUE',
            translations: [{ languageCode: 'zh_Hans', name: '源规格' }],
            options: [{ id: 'o1' }],
            customFields: { digitalDeliveryMode: 'auto_card', digitalStockPolicy: 'pool_derived' },
        },
    ],
};

describe('product editor source projection', () => {
    it('uses source language, minor-unit prices, and stored variant delivery settings', () => {
        const draft = productEditorDraft(product, null, []);
        expect(draft).toMatchObject({
            productName: '源商品',
            slug: 'source',
            description: '源描述',
            fulfillmentType: 'physical',
            manualDeliverySlaMinutes: 5,
            variants: [
                {
                    id: 'v1',
                    name: '源规格',
                    price: '12.99',
                    stockOnHand: 8,
                    stockAllocated: 2,
                    digitalDeliveryMode: 'auto_card',
                    digitalStockPolicy: 'pool_derived',
                    optionIds: ['o1'],
                },
            ],
        });
    });

    it('applies store fulfillment mode and preserves products without variants', () => {
        const draft = productEditorDraft({ ...product, variants: [] }, 'digital', []);
        expect(draft.fulfillmentType).toBe('digital');
        expect(draft.variants).toEqual([]);
        expect(draft.dynamicCustomFields).toEqual({});
    });
});
