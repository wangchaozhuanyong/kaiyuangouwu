import { describe, expect, it } from 'vitest';
import type { DigitalWorkspaceVariant } from '../../graphql/product-domains.graphql';
import {
    hasCreatedProductDraft,
    hasPendingDigitalDeliveryDraft,
    productEditorDraft,
    restoreCreatedProductDraft,
    retainCreatedProductDraft,
    revertPendingDigitalDeliveryDraft,
    takeCreatedProductDraft,
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

    it('preserves a missing operating price as empty while keeping independent other-currency prices', () => {
        const draft = productEditorDraft(
            {
                ...product,
                variants: [
                    {
                        ...product.variants[0],
                        price: null,
                        currencyCode: 'MYR',
                        prices: [{ currencyCode: 'CNY', price: 1299 }],
                    },
                ],
            },
            'physical',
            [],
        );
        expect(draft.variants[0].price).toBe('');
        expect(draft.variants[0].currencyPrices).toEqual({ CNY: '12.99' });
        expect(draft.variants[0].currencyPrices).not.toHaveProperty('MYR');
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
    it('hydrates other currencies, localized SKU fields and authoritative inventory without replacing the raw edit quantity', () => {
        const summary = {
            source: 'LIMITED_QUOTA',
            availableQuantity: 7,
            reservedQuantity: 2,
            consumedQuantity: 3,
            observedAt: '2026-10-16T00:00:00Z',
        };
        const input = {
            ...product,
            variants: [
                {
                    ...product.variants[0],
                    currencyCode: 'CNY',
                    prices: [
                        { currencyCode: 'CNY', price: 1299 },
                        { currencyCode: 'MYR', price: 850 },
                    ],
                    customFields: { specification: '1个月' },
                    translations: [
                        { languageCode: 'zh_Hans', name: '源规格', customFields: { notes: '说明' } },
                    ],
                },
            ],
        };
        const workspace = {
            id: 'v1',
            sku: 'SKU-1',
            deliveryMode: 'manual_service' as const,
            stockPolicy: 'limited' as const,
            availableQuantity: 9,
            migrationRequired: false,
            purchaseCostMicrounits: null,
            fileVersion: null,
            inventory: summary,
        };
        const fields = [
            { name: 'specification', type: 'string', list: false },
            { name: 'notes', type: 'localeString', list: false },
        ];
        const draft = productEditorDraft(input, 'digital', [], [workspace], fields);
        expect(draft.variants[0]).toMatchObject({
            price: '12.99',
            currencyPrices: { MYR: '8.50' },
            variantCustomFields: { specification: '1个月', notes: { zh_Hans: '说明' } },
            digitalAvailableQuantity: 9,
            inventorySummary: summary,
        });
        expect(draft.variants[0].currencyPrices).not.toHaveProperty('CNY');
    });
});

describe('one-use partial-create draft handoff', () => {
    const baseline = () => productEditorDraft(product, 'physical', []);
    it('isolates target products and query scopes, clones the draft and consumes it once', () => {
        const draft = baseline();
        retainCreatedProductDraft('recovery-scope', 'created-1', draft, []);
        draft.productName = 'edited after handoff';
        expect(takeCreatedProductDraft('another-scope', 'created-1')).toBeUndefined();
        expect(takeCreatedProductDraft('recovery-scope', 'another-product')).toBeUndefined();
        expect(hasCreatedProductDraft('recovery-scope', 'created-1')).toBe(true);
        expect(takeCreatedProductDraft('recovery-scope', 'created-1')?.draft.productName).toBe('源商品');
        expect(takeCreatedProductDraft('recovery-scope', 'created-1')).toBeUndefined();
    });

    it('uses real SKU identity while preserving failed settings and unsaved collection selection', () => {
        const persisted = baseline();
        const draft = structuredClone(persisted);
        draft.selectedCollectionIds = ['pending-category'];
        draft.variants[0] = {
            ...draft.variants[0],
            id: undefined,
            isNew: true,
            costPrice: '9.00',
            currencyPrices: { MYR: '22.00' },
            digitalDeliveryMode: 'manual_service',
            digitalStockPolicy: 'limited',
            digitalAvailableQuantity: 40,
        };
        retainCreatedProductDraft('recovery-scope', 'created-2', draft, [{ id: 'v1', sku: 'SKU-1' }]);
        const restored = restoreCreatedProductDraft(
            takeCreatedProductDraft('recovery-scope', 'created-2')!,
            persisted,
        );
        expect(restored.variants).toHaveLength(1);
        expect(restored.variants[0]).toMatchObject({
            id: 'v1',
            isNew: false,
            costPrice: '9.00',
            currencyPrices: { MYR: '22.00' },
            digitalAvailableQuantity: 40,
        });
        expect(restored.selectedCollectionIds).toEqual(['pending-category']);
        expect(restored.productName).toBe(persisted.productName);
    });

    it('adopts current committed inventory and currency values instead of replaying an earlier create snapshot', () => {
        const persisted = baseline();
        persisted.variants[0] = {
            ...persisted.variants[0],
            digitalAvailableQuantity: 39,
            currencyPrices: { MYR: '23.00' },
            stockAllocated: 1,
        };
        const draft = structuredClone(persisted);
        draft.variants[0] = {
            ...draft.variants[0],
            id: undefined,
            isNew: true,
            digitalAvailableQuantity: 40,
            currencyPrices: { MYR: '22.00' },
            costPrice: '9.00',
        };
        retainCreatedProductDraft('recovery-scope', 'created-3', draft, [{ id: 'v1', sku: 'SKU-1' }], {
            v1: ['digital', 'prices'],
        });
        const restored = restoreCreatedProductDraft(
            takeCreatedProductDraft('recovery-scope', 'created-3')!,
            persisted,
        );
        expect(restored.variants[0]).toMatchObject({
            id: 'v1',
            isNew: false,
            digitalAvailableQuantity: 39,
            currencyPrices: { MYR: '23.00' },
            stockAllocated: 1,
            costPrice: '9.00',
        });
    });

    it('does not recreate an acknowledged SKU even if the workspace read omits it', () => {
        const persisted = baseline();
        const draft = structuredClone(persisted);
        draft.variants[0] = { ...draft.variants[0], id: undefined, isNew: true };
        persisted.variants = [];
        retainCreatedProductDraft('recovery-scope', 'created-4', draft, [
            { id: 'created-sku', sku: 'SKU-1' },
        ]);
        const restored = restoreCreatedProductDraft(
            takeCreatedProductDraft('recovery-scope', 'created-4')!,
            persisted,
        );
        expect(restored.variants[0]).toMatchObject({ id: 'created-sku', isNew: false });
    });
});

it('uses current stock for an unconfirmed quantity attempt without discarding other failed fields', () => {
    const baseline = productEditorDraft(product, 'physical', []);
    baseline.variants[0] = {
        ...baseline.variants[0],
        digitalDeliveryMode: 'manual_service',
        digitalStockPolicy: 'limited',
        digitalAvailableQuantity: 39,
    };
    const draft = structuredClone(baseline);
    draft.variants[0] = {
        ...draft.variants[0],
        id: undefined,
        isNew: true,
        digitalAvailableQuantity: 40,
        costPrice: '9.00',
        currencyPrices: { MYR: '22.00' },
    };
    retainCreatedProductDraft(
        'unconfirmed-scope',
        'created-response-lost',
        draft,
        [{ id: 'v1', sku: 'SKU-1' }],
        {},
        ['v1'],
    );
    const restored = restoreCreatedProductDraft(
        takeCreatedProductDraft('unconfirmed-scope', 'created-response-lost')!,
        baseline,
    );
    expect(restored.variants[0]).toMatchObject({
        id: 'v1',
        isNew: false,
        digitalAvailableQuantity: 39,
        costPrice: '9.00',
        currencyPrices: { MYR: '22.00' },
    });
});
