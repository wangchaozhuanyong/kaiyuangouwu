import { describe, expect, it } from 'vitest';

import type { ProductVariantState } from './product-editor-types';
import { mergeProductEditorReadbackDraft, mergeWorkspaceReadbackVariants } from './useProductEditorForm';
import type { ProductEditorSaveDraft } from './useProductEditorSave';

const original: ProductVariantState = {
    id: 'sku-1',
    sku: 'SKU-1',
    name: 'Original',
    price: '10.00',
    costPrice: '5.00',
    stockOnHand: 10,
    stockAllocated: 0,
    enabled: true,
    optionIds: [],
    digitalDeliveryMode: 'file_download',
    digitalStockPolicy: 'limited',
    digitalAvailableQuantity: 10,
    digitalFileVersionId: 'old-file',
    digitalMigrationRequired: true,
};

describe('digital workspace readback draft protection', () => {
    it('refreshes unchanged fields and migration metadata while preserving edits and new rows', () => {
        const edited = { ...original, name: 'Draft name', costPrice: '', digitalFileVersionId: 'draft-file' };
        const added = { ...original, id: undefined, sku: 'NEW', isNew: true };
        const remote = {
            ...original,
            costPrice: '8.00',
            digitalFileVersionId: 'server-file',
            digitalAvailableQuantity: 12,
            digitalMigrationRequired: false,
        };
        const result = mergeWorkspaceReadbackVariants([edited, added], [original], [remote]);
        expect(result).toEqual([
            { ...edited, digitalAvailableQuantity: 12, digitalMigrationRequired: false },
            added,
        ]);
        expect(edited.digitalMigrationRequired).toBe(true);
    });

    it('does not restore a SKU removed from the draft or mix unrelated workspace IDs', () => {
        expect(mergeWorkspaceReadbackVariants([], [original], [original])).toEqual([]);
        const edited = { ...original, sku: 'Draft SKU' };
        expect(
            mergeWorkspaceReadbackVariants([edited], [original], [{ ...original, id: 'other-store-sku' }]),
        ).toEqual([edited]);
    });

    it('keeps a draft edit through repeated reads while untouched fields follow the newest value', () => {
        const edited = { ...original, costPrice: '' };
        const firstRead = { ...original, costPrice: '8.00', digitalAvailableQuantity: 12 };
        const first = mergeWorkspaceReadbackVariants([edited], [original], [firstRead]);
        const second = mergeWorkspaceReadbackVariants(
            first,
            [firstRead],
            [{ ...firstRead, costPrice: '9.00', digitalAvailableQuantity: 15 }],
        );
        expect(second[0]).toMatchObject({ costPrice: '', digitalAvailableQuantity: 15 });
    });

    it('adopts the confirmed SKU identity while preserving changes typed after save started', () => {
        const submitted = { ...original, id: undefined, sku: 'NEW', isNew: true };
        const current = { ...submitted, name: 'Name typed during save', costPrice: '' };
        const confirmed = { ...submitted, id: 'created-1', isNew: false };
        const result = mergeWorkspaceReadbackVariants([current], [submitted], [confirmed]);
        expect(result[0]).toMatchObject({
            id: 'created-1',
            isNew: false,
            name: 'Name typed during save',
            costPrice: '',
        });
    });

    it('preserves form and association drafts when a new Product object arrives with inventory readback', () => {
        const previous: ProductEditorSaveDraft = {
            productName: 'Original',
            slug: 'original',
            enabled: true,
            description: 'Original description',
            fulfillmentType: 'digital',
            refundPolicy: 'MERCHANT_REVIEW',
            manualDeliverySlaMinutes: 1440,
            featuredAssetId: 'image-1',
            selectedAssetIds: ['image-1'],
            selectedFacetValueIds: [],
            selectedCollectionIds: [],
            selectedChannelIds: ['store-1'],
            selectedOptionGroupIds: [],
            variants: [original],
            dynamicCustomFields: { note: 'Original note' },
        };
        const current: ProductEditorSaveDraft = {
            ...previous,
            productName: 'Draft name',
            description: 'Typed while waiting',
            selectedChannelIds: ['store-1', 'store-2'],
            selectedAssetIds: ['image-1', 'image-2'],
            dynamicCustomFields: { note: 'Draft note' },
            variants: [{ ...original, costPrice: '' }],
        };
        const incoming: ProductEditorSaveDraft = {
            ...previous,
            slug: 'new-server-slug',
            productName: 'Changed remotely',
            variants: [
                {
                    ...original,
                    digitalMigrationRequired: false,
                    digitalAvailableQuantity: 12,
                    costPrice: '8.00',
                },
            ],
        };
        const result = mergeProductEditorReadbackDraft(current, previous, incoming);
        expect(result).toMatchObject({
            productName: 'Draft name',
            description: 'Typed while waiting',
            slug: 'new-server-slug',
            selectedChannelIds: ['store-1', 'store-2'],
            selectedAssetIds: ['image-1', 'image-2'],
            dynamicCustomFields: { note: 'Draft note' },
            variants: [
                expect.objectContaining({
                    costPrice: '',
                    digitalMigrationRequired: false,
                    digitalAvailableQuantity: 12,
                }),
            ],
        });
    });
});
