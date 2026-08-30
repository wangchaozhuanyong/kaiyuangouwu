import { GraphQLTypesLoader } from '@nestjs/graphql';
import { defaultConfig, getFinalVendureSchema, VENDURE_ADMIN_API_TYPE_PATHS } from '@vendure/core';
import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions } from './api-extensions';
import { CatalogManagementPlugin } from './catalog-management.plugin';

describe('catalog import privacy contract', () => {
    it('accepts only metadata and normalized chunk rows, never uploaded file bytes', () => {
        const schema = print(adminApiExtensions);

        expect(schema).toContain('beginCatalogImport');
        expect(schema).toContain('appendCatalogImportRows');
        expect(schema).toContain('finalizeCatalogImportPreview');
        expect(schema).toContain('saveCatalogProduct');
        expect(schema).toContain('catalogProductSummaries');
        expect(schema).toContain('catalogProducts');
        expect(schema).toContain('createCatalogProductVariant');
        expect(schema).toContain('catalogSuppliers');
        expect(schema).toContain('supplier: String!');
        expect(schema).toContain('rows: [CatalogNormalizedRowInput!]!');
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
        expect(schema).toContain('type CatalogSupplierVariant implements Node');
        expect(schema).toContain('type CatalogSupplierVariantList implements PaginatedList');
    });

    it('builds the final Admin API schema with catalog extensions', async () => {
        await expect(
            getFinalVendureSchema({
                config: { ...defaultConfig, plugins: [CatalogManagementPlugin] },
                typePaths: VENDURE_ADMIN_API_TYPE_PATHS,
                typesLoader: new GraphQLTypesLoader(),
                apiType: 'admin',
            }),
        ).resolves.toBeDefined();
    });
});
