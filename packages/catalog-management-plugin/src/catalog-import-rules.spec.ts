import { describe, expect, it } from 'vitest';

import {
    catalogImportOptionCode,
    catalogImportOptionGroupCode,
    changed,
    changedOptional,
    isCatalogImportResolutionState,
    productDescriptionForCreate,
} from './catalog-import-planning';
import { CatalogImportService, clearsVariantIdentity, shouldClear } from './catalog-import.service';
import { NormalizedCatalogRow } from './types';

describe('catalog import blank clearing rules', () => {
    it('does not rewrite human-readable fields solely because import normalizes Unicode punctuation', () => {
        const changes: Record<string, unknown> = {};
        changed(changes, 'productName', '商品(A)', '商品（A）');
        changed(changes, 'category', '分类(A)', '分类（A）');
        changedOptional(changes, 'productDescription', '原描述,不变', '原描述，不变', false);
        expect(changes).toEqual({});

        changedOptional(changes, 'productDescription', '真正修改', '原描述，不变', false);
        expect(changes.productDescription).toEqual({ from: '原描述，不变', to: '真正修改' });
        changedOptional(changes, 'productDescription', '', '原描述，不变', true, '');
        expect(changes.productDescription).toEqual({ from: '原描述，不变', to: '' });
        changed(changes, 'sku', 'SKU(A)', 'SKU（A）');
        expect(changes.sku).toEqual({ from: 'SKU（A）', to: 'SKU(A)' });
    });

    it('only clears an explicitly present blank column when the mode is enabled', () => {
        const row = { raw: { description: null, minimumStock: 0 } } as unknown as NormalizedCatalogRow;

        expect(shouldClear(row, 'description', false)).toBe(false);
        expect(shouldClear(row, 'description', true)).toBe(true);
        expect(shouldClear(row, 'brand', true)).toBe(false);
        expect(shouldClear(row, 'minimumStock', true)).toBe(false);
    });

    it('treats whitespace as blank without treating numeric zero as blank', () => {
        const row = { raw: { barcode: '   ', shelfLifeDays: 0 } } as unknown as NormalizedCatalogRow;

        expect(shouldClear(row, 'barcode', true)).toBe(true);
        expect(shouldClear(row, 'shelfLifeDays', true)).toBe(false);
    });

    it('detects when blank clearing changes the SKU matching identity', () => {
        const row = {
            raw: { specification: '', primaryUnit: null },
        } as unknown as NormalizedCatalogRow;

        expect(clearsVariantIdentity(row, false)).toBe(false);
        expect(clearsVariantIdentity(row, true)).toBe(true);
    });

    it('uses the product name when a new product has no description', () => {
        const row = { ...normalizedRow(), name: ' new name ', description: '' };

        expect(productDescriptionForCreate(row)).toBe('new name');
        expect(productDescriptionForCreate({ ...row, description: 'Detailed description' })).toBe(
            'Detailed description',
        );
    });

    it('allows failed and partially completed imports to resolve rows and retry', () => {
        expect(isCatalogImportResolutionState('PREVIEW_READY')).toBe(true);
        expect(isCatalogImportResolutionState('FAILED')).toBe(true);
        expect(isCatalogImportResolutionState('COMPLETED_WITH_ERRORS')).toBe(true);
        expect(isCatalogImportResolutionState('RUNNING')).toBe(false);
        expect(isCatalogImportResolutionState('COMPLETED')).toBe(false);
    });

    it('creates stable, distinct internal option identifiers for imported SKUs', () => {
        expect(catalogImportOptionGroupCode('product-1')).toBe('import-sku-product-1');
        expect(catalogImportOptionCode('ABC:row-1')).toBe('import-abc-row-1');
        expect(catalogImportOptionCode('ABC:row-1')).not.toBe(catalogImportOptionCode('ABC:row-2'));
    });

    it('plans name and imported-category changes while preserving blank optional values', () => {
        const service = new CatalogImportService(
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
        );
        const diff = Reflect.get(service, 'diffRow') as (
            row: NormalizedCatalogRow,
            snapshot: Record<string, unknown>,
            currencyCode: string,
            clearBlankFields: boolean,
        ) => Record<string, unknown>;
        const changes = diff.call(
            service,
            normalizedRow(),
            {
                productName: '旧名称',
                productImportCategory: '旧分类',
                productEnabled: true,
                variantEnabled: true,
                productDescription: '人工描述',
                sku: 'SKU-1',
                packageQuantity: 1,
                sellingPrice: 200,
                purchaseCostMicrounits: 1_000,
                stockOnHand: 5,
                productTags: [],
            },
            'MYR',
            false,
        );

        expect(changes).toMatchObject({
            productName: { from: '旧名称', to: '新名称' },
            category: { from: '旧分类', to: '新分类' },
        });
        expect(changes).not.toHaveProperty('productDescription');
    });

    it('treats blank re-import cells as preserve operations for every critical value', () => {
        const service = new CatalogImportService(
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
        );
        const diff = Reflect.get(service, 'diffRow') as (
            row: NormalizedCatalogRow,
            snapshot: Record<string, unknown>,
            currencyCode: string,
            clearBlankFields: boolean,
        ) => Record<string, unknown>;
        const row = {
            ...normalizedRow(),
            name: '',
            category: '',
            packageQuantity: null,
            stockOnHand: null,
            purchaseCost: null,
            sellingPrice: null,
            enabled: null,
            variantEnabled: null,
        };

        const changes = diff.call(
            service,
            row,
            {
                productName: '原名称',
                productImportCategory: '原分类',
                productEnabled: true,
                variantEnabled: true,
                packageQuantity: 12,
                sellingPrice: 200,
                purchaseCostMicrounits: 1_000,
                stockOnHand: 5,
                productTags: [],
            },
            'MYR',
            false,
        );

        expect(changes).not.toHaveProperty('productName');
        expect(changes).not.toHaveProperty('category');
        expect(changes).not.toHaveProperty('packageQuantity');
        expect(changes).not.toHaveProperty('sellingPrice');
        expect(changes).not.toHaveProperty('purchaseCostMicrounits');
        expect(changes).not.toHaveProperty('stockOnHand');
        expect(changes).not.toHaveProperty('productEnabled');
        expect(changes).not.toHaveProperty('variantEnabled');
    });
});

function normalizedRow(): NormalizedCatalogRow {
    return {
        rowNumber: 2,
        name: '新名称',
        category: '新分类',
        channelCode: '',
        stockLocationCode: '',
        currencyCode: '',
        specification: '',
        primaryUnit: '',
        purchaseUnit: '',
        packageQuantity: 1,
        stockOnHand: 5,
        purchaseCost: 1,
        sellingPrice: 2,
        reportedMargin: null,
        maximumStock: null,
        minimumStock: null,
        brand: '',
        manufacturedAt: null,
        shelfLifeDays: null,
        enabled: true,
        variantEnabled: true,
        description: '',
        tags: [],
        sourceCreatedAt: null,
        sku: 'SKU-1',
        barcode: '',
        lotCode: '',
        lotQuantity: null,
        supplier: '',
        providedFields: ['name', 'category', 'sku', 'purchaseCost', 'sellingPrice', 'stockOnHand'],
    };
}
