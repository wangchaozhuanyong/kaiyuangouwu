import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddContentTranslationState1787666400000 } from './1787666400000-add-content-translation-state';
import { LocalizeCustomerServiceContent1787670000000 } from './1787670000000-localize-customer-service-content';
import { AlignProductionMysqlSchema1787682600000 } from './1787682600000-align-production-mysql-schema';
import { SeedSimplifiedChineseSourceTranslations1787684400000 } from './1787684400000-seed-simplified-chinese-source-translations';

describe('content translation migrations', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable translation audit state on %s',
        async type => {
            const created: Table[] = [];
            const queryRunner = {
                connection: { options: { type } },
                hasTable: vi.fn(async () => false),
                createTable: vi.fn(async (table: Table) => created.push(table)),
            } as unknown as QueryRunner;

            await new AddContentTranslationState1787666400000().up(queryRunner);

            expect(created).toHaveLength(1);
            expect(created[0].name).toBe('content_translation_state');
            expect(created[0].findColumnByName('stateKey')).toMatchObject({ length: '64' });
            expect(created[0].findColumnByName('locked')?.type).toBe(
                type === 'mysql' ? 'tinyint' : 'boolean',
            );
            expect(created[0].findColumnByName('createdAt')).toMatchObject(
                type === 'mysql'
                    ? { type: 'datetime', precision: 6, default: 'CURRENT_TIMESTAMP(6)' }
                    : type === 'postgres'
                      ? { type: 'timestamp without time zone', default: 'CURRENT_TIMESTAMP' }
                      : { type: 'datetime', default: "datetime('now')" },
            );
            expect(created[0].findColumnByName('updatedAt')?.onUpdate).toBe(
                type === 'mysql' ? 'CURRENT_TIMESTAMP(6)' : undefined,
            );
            expect(created[0].indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_content_translation_state_key', isUnique: true }),
                    expect.objectContaining({ name: 'IDX_content_translation_state_audit' }),
                ]),
            );
        },
    );

    it.each(['mysql', 'postgres'] as const)(
        'adds localized review and after-sales fields on %s',
        async type => {
            const tables = {
                storefront_review: new Table({
                    name: 'storefront_review',
                    columns: [{ name: 'merchantResponse', type: 'text', isNullable: true }],
                }),
                after_sales_request: new Table({
                    name: 'after_sales_request',
                    columns: [{ name: 'resolution', type: 'text', isNullable: true }],
                }),
            };
            const query = vi.fn(async () => undefined);
            const queryRunner = {
                connection: { options: { type } },
                getTable: vi.fn(async (name: keyof typeof tables) => tables[name]),
                addColumn: vi.fn(async (table: Table, column: TableColumn) => table.addColumn(column)),
                query,
            } as unknown as QueryRunner;

            await new LocalizeCustomerServiceContent1787670000000().up(queryRunner);

            expect(tables.storefront_review.findColumnByName('merchantResponseZh')).toBeDefined();
            expect(tables.storefront_review.findColumnByName('merchantResponseEn')).toBeDefined();
            expect(tables.after_sales_request.findColumnByName('resolutionZh')).toBeDefined();
            expect(tables.after_sales_request.findColumnByName('resolutionEn')).toBeDefined();
            expect(query).toHaveBeenCalledTimes(2);
            expect(query.mock.calls[0]?.[0]).toContain(
                type === 'mysql' ? '`merchantResponseZh`' : '"merchantResponseZh"',
            );
        },
    );

    it('aligns MySQL timestamps and coupon metadata without dropping customer data', async () => {
        const tables = {
            content_translation_state: new Table({
                name: 'content_translation_state',
                columns: [
                    { name: 'createdAt', type: 'timestamp' },
                    { name: 'updatedAt', type: 'timestamp' },
                ],
            }),
            customer_coupon: new Table({
                name: 'customer_coupon',
                columns: [
                    { name: 'discountRate', type: 'double', isNullable: true },
                    { name: 'version', type: 'int', default: 1 },
                ],
            }),
        };
        const changeColumn = vi.fn(async () => undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn(async (name: keyof typeof tables) => tables[name]),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignProductionMysqlSchema1787682600000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(4);
        expect(changeColumn.mock.calls[0]?.[2]).toMatchObject({
            name: 'createdAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
        });
        expect(changeColumn.mock.calls[1]?.[2]).toMatchObject({
            name: 'updatedAt',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
        });
        expect(changeColumn.mock.calls[2]?.[2]).toMatchObject({
            name: 'discountRate',
            type: 'float',
            isNullable: true,
            default: undefined,
        });
        expect(changeColumn.mock.calls[3]?.[2]).toMatchObject({
            name: 'version',
            type: 'int',
            isNullable: false,
            default: undefined,
        });
    });

    it.each(['mysql', 'postgres'] as const)(
        'seeds Chinese-authored legacy English rows without copying English-only rows on %s',
        async type => {
            const productTable = new Table({
                name: 'product_translation',
                columns: [
                    { name: 'createdAt', type: 'datetime' },
                    { name: 'updatedAt', type: 'datetime' },
                    { name: 'languageCode', type: 'varchar' },
                    { name: 'name', type: 'varchar' },
                    { name: 'slug', type: 'varchar' },
                    { name: 'description', type: 'text' },
                    { name: 'baseId', type: 'int' },
                ],
            });
            const query = vi.fn(async (sql: string) =>
                sql.startsWith('SELECT')
                    ? [
                          {
                              baseId: 1,
                              name: '中文商品',
                              slug: 'zhong-wen-shang-pin',
                              description: '<p>中文介绍</p>',
                          },
                          {
                              baseId: 2,
                              name: 'English only',
                              slug: 'english-only',
                              description: '<p>English description</p>',
                          },
                      ]
                    : undefined,
            );
            const queryRunner = {
                connection: { options: { type } },
                getTable: vi.fn(async (name: string) =>
                    name === 'product_translation' ? productTable : undefined,
                ),
                query,
            } as unknown as QueryRunner;

            await new SeedSimplifiedChineseSourceTranslations1787684400000().up(queryRunner);

            expect(query).toHaveBeenCalledTimes(2);
            expect(query.mock.calls[0]?.[1]).toEqual(['en']);
            expect(query.mock.calls[1]?.[1]).toEqual(['zh_Hans', 1, 'en', 'zh_Hans']);
            expect(query.mock.calls[1]?.[0]).toContain(
                type === 'mysql' ? '`languageCode` = ?' : '"languageCode" = $3',
            );
        },
    );
});
