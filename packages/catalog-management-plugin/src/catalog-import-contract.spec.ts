import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions } from './api-extensions';

describe('catalog import privacy contract', () => {
    it('accepts only metadata and normalized chunk rows, never uploaded file bytes', () => {
        const schema = print(adminApiExtensions);

        expect(schema).toContain('beginCatalogImport');
        expect(schema).toContain('appendCatalogImportRows');
        expect(schema).toContain('finalizeCatalogImportPreview');
        expect(schema).toContain('saveCatalogProduct');
        expect(schema).toContain('catalogProductSummaries');
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
    });
});
