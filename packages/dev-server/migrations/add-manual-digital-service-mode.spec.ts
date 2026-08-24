import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { serviceCatalogProducts } from './1787612400000-complete-bilingual-service-catalog';
import { AddManualDigitalServiceMode1787616000000 } from './1787616000000-add-manual-digital-service-mode';

describe('manual digital service mode migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'updates known service SKUs and changes defaults on %s',
        async databaseType => {
            const productVariant = new Table({
                name: 'product_variant',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'sku', type: 'varchar' },
                    { name: 'customFieldsFulfillmenttype', type: 'varchar' },
                    {
                        name: 'customFieldsDigitaldeliverymode',
                        type: 'varchar',
                        default: "'file_download'",
                    },
                ],
            });
            const orderLine = new Table({
                name: 'order_line',
                columns: [
                    { name: 'id', type: 'int' },
                    {
                        name: 'customFieldsDigitaldeliverymodesnapshot',
                        type: 'varchar',
                        default: "'file_download'",
                    },
                ],
            });
            const queries: string[] = [];
            const defaults: string[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn((name: string) =>
                    Promise.resolve(
                        name === 'product_variant'
                            ? productVariant
                            : name === 'order_line'
                              ? orderLine
                              : undefined,
                    ),
                ),
                changeColumn: vi.fn((_table, _column, updatedColumn) => {
                    defaults.push(updatedColumn.default);
                    return Promise.resolve();
                }),
                query: vi.fn((sql: string) => {
                    queries.push(sql);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddManualDigitalServiceMode1787616000000().up(queryRunner);

            expect(serviceCatalogProducts).toHaveLength(50);
            expect(defaults).toEqual(["'manual_service'", "'manual_service'"]);
            expect(queries).toHaveLength(1);
            expect(queries[0]).toContain("= 'manual_service'");
            expect(queries[0]).toContain("= 'file_download'");
            for (const product of serviceCatalogProducts) {
                expect(queries[0]).toContain(`'${product.sku}'`);
            }
        },
    );
});
