import { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddMainlandChineseCatalogContent1786515300000 } from './1786515300000-add-mainland-chinese-catalog-content';

describe('AddMainlandChineseCatalogContent migration', () => {
    it('only inserts named translations when the English base translation exists', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            query,
        } as unknown as QueryRunner;

        await new AddMainlandChineseCatalogContent1786515300000().up(queryRunner);

        const variantInsert = query.mock.calls.find(([sql]) =>
            String(sql).includes('INSERT INTO "product_variant_translation"'),
        );

        expect(variantInsert?.[0]).toContain('FROM "product_variant_translation" source');
        expect(variantInsert?.[0]).toContain("source.\"languageCode\" = 'en'");
        expect(variantInsert?.[0]).toContain('existing."baseId" = source."baseId"');
    });
});
