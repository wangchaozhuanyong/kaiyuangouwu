import { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import {
    CompleteBilingualServiceCatalog1787612400000,
    serviceCatalogCollections,
    serviceCatalogProducts,
} from './1787612400000-complete-bilingual-service-catalog';

describe('CompleteBilingualServiceCatalog migration', () => {
    it('contains a unique English translation for every live service product and collection', () => {
        expect(serviceCatalogProducts).toHaveLength(50);
        expect(new Set(serviceCatalogProducts.map(product => product.slug)).size).toBe(50);
        expect(new Set(serviceCatalogProducts.map(product => product.sku)).size).toBe(50);
        expect(serviceCatalogProducts.every(product => !/[\p{Script=Han}]/u.test(product.nameEn))).toBe(true);
        expect(serviceCatalogCollections).toHaveLength(35);
        expect(new Set(serviceCatalogCollections.map(collection => collection.slug)).size).toBe(35);
    });

    it('updates existing rows and inserts any missing English translation', async () => {
        const query = vi.fn((sql: string, parameters?: unknown[]) => {
            if (sql.includes('FROM "product_translation" WHERE "slug"')) {
                return Promise.resolve(
                    parameters?.[0] === serviceCatalogProducts[0].slug ? [{ baseId: 65 }] : [],
                );
            }
            if (sql.includes('FROM "product_variant"')) return Promise.resolve([{ id: 99 }]);
            return Promise.resolve([]);
        });
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(() => Promise.resolve(true)),
            query,
        } as unknown as QueryRunner;

        await new CompleteBilingualServiceCatalog1787612400000().up(queryRunner);

        const productUpdate = query.mock.calls.find(([sql]) =>
            String(sql).startsWith('UPDATE "product_translation"'),
        );
        const variantInsert = query.mock.calls.find(([sql]) =>
            String(sql).startsWith('INSERT INTO "product_variant_translation"'),
        );
        expect(productUpdate?.[1]).toContain('ChatGPT Go | 1-Month Setup on Your Account');
        expect(variantInsert?.[0]).toContain('NOT EXISTS');
    });
});
