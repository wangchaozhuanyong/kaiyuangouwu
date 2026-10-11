import { describe, expect, it } from 'vitest';
import type { DigitalWorkspaceVariant } from '../../graphql/product-domains.graphql';
import {
    hasPendingDigitalDeliveryDraft,
    productEditorDraft,
    revertPendingDigitalDeliveryDraft,
} from './product-editor-draft';
import type { ProductDetailRecord } from './product-editor-types';

const product: ProductDetailRecord = {
    id: 'p1',
    createdAt: '2026-09-12T00:00:00.000Z',
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

    it('keeps missing Chinese editor values empty instead of copying the first English record', () => {
        const draft = productEditorDraft(
            {
                ...product,
                name: 'English fallback',
                description: 'English copy',
                translations: [
                    {
                        id: 'en',
                        languageCode: 'en',
                        name: 'English name',
                        description: 'English description',
                        slug: 'english-slug',
                    },
                ],
                variants: [
                    {
                        ...product.variants[0],
                        translations: [{ languageCode: 'en', name: 'English variant' }],
                    },
                ],
            },
            null,
            [],
        );
        expect(draft.productName).toBe('');
        expect(draft.description).toBe('');
        expect(draft.variants[0].name).toBe('');
        expect(draft.slug).toBe(product.slug);
    });

    it('applies store fulfillment mode and preserves products without variants', () => {
        const draft = productEditorDraft({ ...product, variants: [] }, 'digital', []);
        expect(draft.fulfillmentType).toBe('digital');
        expect(draft.variants).toEqual([]);
        expect(draft.dynamicCustomFields).toEqual({});
    });

    it.each([
        [null, ''],
        [0, '0.00'],
        [7500, '7.50'],
    ] as const)(
        'reads the latest nullable cost %s without a fallback to older product values',
        (cost, expected) => {
            const draft = productEditorDraft(
                product,
                'physical',
                [],
                [{ id: 'v1', purchaseCostMicrounits: cost }],
            );
            expect(draft.variants[0].costPrice).toBe(expected);
        },
    );

    it('uses only current-store digital workspace SKU IDs while keeping product order', () => {
        const workspace: DigitalWorkspaceVariant = {
            id: 'v1',
            sku: 'SKU-1',
            deliveryMode: 'file_download',
            stockPolicy: 'limited',
            availableQuantity: 12,
            migrationRequired: true,
            purchaseCostMicrounits: null,
            fileVersion: null,
        };
        const multiStoreProduct = {
            ...product,
            variants: [
                product.variants[0],
                { ...product.variants[0], id: 'removed-store-sku', sku: 'OTHER' },
            ],
        };
        expect(
            productEditorDraft(multiStoreProduct, 'digital', [], [workspace]).variants.map(v => v.id),
        ).toEqual(['v1']);
        expect(productEditorDraft(multiStoreProduct, 'digital', [], []).variants).toEqual([]);
        expect(productEditorDraft(multiStoreProduct, 'digital', []).variants).toEqual([]);
    });

    it('deliberately reverts only legacy delivery input to the latest read baseline', () => {
        const baseline = productEditorDraft(
            product,
            'digital',
            [],
            [
                {
                    id: 'v1',
                    sku: 'SKU-1',
                    deliveryMode: 'file_download',
                    stockPolicy: 'limited',
                    availableQuantity: null,
                    migrationRequired: true,
                    purchaseCostMicrounits: 5000,
                    fileVersion: { id: 'existing-file', fileName: 'existing.pdf' },
                },
            ],
        ).variants[0];
        const edited = {
            ...baseline,
            name: 'Name draft',
            costPrice: '',
            supplierId: 'draft-supplier',
            digitalDeliveryMode: 'manual_service' as const,
            digitalStockPolicy: 'unlimited' as const,
            digitalAvailableQuantity: 99,
            digitalFileVersionId: 'new-file',
            digitalFileName: 'new.pdf',
        };
        expect(hasPendingDigitalDeliveryDraft(edited, baseline)).toBe(true);
        const restored = revertPendingDigitalDeliveryDraft(edited, baseline);
        expect(restored).toEqual({
            ...edited,
            digitalDeliveryMode: baseline.digitalDeliveryMode,
            digitalStockPolicy: baseline.digitalStockPolicy,
            digitalAvailableQuantity: baseline.digitalAvailableQuantity,
            digitalFileVersionId: baseline.digitalFileVersionId,
            digitalFileName: baseline.digitalFileName,
        });
        expect(restored).toMatchObject({ name: 'Name draft', costPrice: '', supplierId: 'draft-supplier' });
        expect(edited.digitalFileVersionId).toBe('new-file');
        expect(hasPendingDigitalDeliveryDraft(restored, baseline)).toBe(false);
    });

    it('cannot undo delivery input without a matching pending current-store SKU baseline', () => {
        const baseline = productEditorDraft(
            product,
            'digital',
            [],
            [
                {
                    id: 'v1',
                    sku: 'SKU-1',
                    deliveryMode: 'manual_service',
                    stockPolicy: 'unlimited',
                    availableQuantity: null,
                    migrationRequired: true,
                    purchaseCostMicrounits: null,
                    fileVersion: null,
                },
            ],
        ).variants[0];
        const edited = { ...baseline, digitalFileVersionId: 'draft-file' };
        for (const invalid of [
            undefined,
            { ...baseline, id: 'another-store-sku' },
            { ...baseline, digitalMigrationRequired: false },
        ]) {
            expect(revertPendingDigitalDeliveryDraft(edited, invalid)).toBe(edited);
            expect(hasPendingDigitalDeliveryDraft(edited, invalid)).toBe(false);
        }
    });
});
