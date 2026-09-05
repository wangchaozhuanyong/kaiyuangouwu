import { Kind, print, type TypeNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions } from './api-extensions';

describe('catalog import privacy contract', () => {
    it('accepts only metadata and normalized chunk rows, never uploaded file bytes', () => {
        const schema = print(adminApiExtensions);

        expect(schema).toContain('beginCatalogImport');
        expect(schema).toContain('catalogImportRowPage');
        expect(schema).toContain('type CatalogImportRowList implements PaginatedList');
        expect(schema).toContain('appendCatalogImportRows');
        expect(schema).toContain('finalizeCatalogImportPreview');
        expect(schema).toContain('saveCatalogProduct');
        expect(schema).toContain('catalogProductSummaries');
        expect(schema).toContain('catalogProductOperations');
        expect(schema).toContain('catalogOrderProfitExpense');
        expect(schema).toContain('catalogProfitReport');
        expect(schema).toContain('saveCatalogOrderProfitExpense');
        expect(schema).toContain('importCatalogOrderProfitExpenses');
        expect(schema).toContain('rows: [CatalogOrderProfitExpenseImportRowInput!]!');
        expect(schema).toContain('catalogProducts');
        expect(schema).toContain('createCatalogProductVariant');
        expect(schema).toContain('createCatalogProduct');
        expect(schema).toContain('catalogProductCreationContext');
        expect(schema).toContain('catalogIntegritySummary');
        expect(schema).toContain('catalogSuppliers');
        expect(schema).toContain('supplier: String!');
        expect(schema).toContain('rows: [CatalogNormalizedRowInput!]!');
        expect(schema).toContain('sourceRecordKey: String');
        expect(schema).toContain('receivedRows: Int!');
        expect(schema).not.toContain('Upload');
        expect(schema).not.toContain('multipart');
        expect(schema).not.toMatch(/\braw\s*:/u);
        expect(schema).not.toContain('catalogStandardImportTemplate');
        expect(schema).not.toContain('catalogImportReport');
    });

    it('keeps export pagination compatible with the Vendure Node contract', () => {
        const schema = print(adminApiExtensions);

        expect(schema).not.toContain('type CatalogExportPage implements PaginatedList');
        expect(schema).toContain('type CatalogExportPage {');
    });

    it('uses Node items for every Vendure PaginatedList implementation', () => {
        const objectTypes = adminApiExtensions.definitions.filter(
            definition => definition.kind === Kind.OBJECT_TYPE_DEFINITION,
        );
        const nodeTypes = new Set(
            objectTypes
                .filter(definition => definition.interfaces?.some(item => item.name.value === 'Node'))
                .map(definition => definition.name.value),
        );
        const paginatedTypes = objectTypes.filter(definition =>
            definition.interfaces?.some(item => item.name.value === 'PaginatedList'),
        );
        const unwrapTypeName = (type: TypeNode): string =>
            type.kind === Kind.NAMED_TYPE ? type.name.value : unwrapTypeName(type.type);

        expect(paginatedTypes.length).toBeGreaterThan(0);
        for (const paginatedType of paginatedTypes) {
            const itemsField = paginatedType.fields?.find(field => field.name.value === 'items');
            if (itemsField == null) {
                throw new Error(`${paginatedType.name.value}.items must be declared`);
            }
            expect(
                nodeTypes.has(unwrapTypeName(itemsField.type)),
                `${paginatedType.name.value}.items must implement Node`,
            ).toBe(true);
        }
    });
});
