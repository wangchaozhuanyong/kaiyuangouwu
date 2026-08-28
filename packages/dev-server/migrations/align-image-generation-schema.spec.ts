import { QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignImageGenerationSchema1787803200000 } from './1787803200000-align-image-generation-schema';

function createTables() {
    return new Map<string, Table>([
        [
            'image_generation_config',
            new Table({
                name: 'image_generation_config',
                columns: [
                    { name: 'termsZh', type: 'text', isNullable: false },
                    { name: 'termsEn', type: 'text', isNullable: false },
                ],
            }),
        ],
        [
            'image_generation_job',
            new Table({
                name: 'image_generation_job',
                columns: [{ name: 'version', type: 'int', isNullable: false, default: 1 }],
            }),
        ],
        [
            'image_generation_output',
            new Table({
                name: 'image_generation_output',
                columns: [{ name: 'version', type: 'int', isNullable: false, default: 1 }],
            }),
        ],
        [
            'referral_wallet_usage',
            new Table({
                name: 'referral_wallet_usage',
                columns: [{ name: 'version', type: 'int', isNullable: false, default: 1 }],
            }),
        ],
        [
            'referral_program_config',
            new Table({
                name: 'referral_program_config',
                columns: [
                    {
                        name: 'currencyCode',
                        type: 'varchar',
                        length: '3',
                        isNullable: false,
                        default: "'CNY'",
                    },
                ],
            }),
        ],
        [
            'customer_coupon',
            new Table({
                name: 'customer_coupon',
                columns: [
                    {
                        name: 'currencyCode',
                        type: 'varchar',
                        length: '3',
                        isNullable: false,
                        default: "'CNY'",
                    },
                ],
            }),
        ],
        [
            'image_private_asset',
            new Table({
                name: 'image_private_asset',
                columns: [{ name: 'storageKey', type: 'varchar', length: '255' }],
                indices: [
                    {
                        name: 'UQ_1fc089a5d1f00e49613178fd263',
                        columnNames: ['storageKey'],
                        isUnique: true,
                    },
                ],
            }),
        ],
    ]);
}

describe('image generation schema alignment', () => {
    it('aligns MySQL defaults and replaces the generated storage key index', async () => {
        const tables = createTables();
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const dropIndex = vi.fn().mockResolvedValue(undefined);
        const createIndex = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
            query: vi.fn().mockResolvedValue([]),
            dropIndex,
            dropUniqueConstraint: vi.fn().mockResolvedValue(undefined),
            createIndex,
        } as unknown as QueryRunner;

        await new AlignImageGenerationSchema1787803200000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(5);
        const alignedColumns = changeColumn.mock.calls.map(call => {
            const [table, _current, aligned] = call as unknown as [Table, TableColumn, TableColumn];
            return {
                table: table.name,
                name: aligned.name,
                default: aligned.default,
            };
        });
        expect(alignedColumns).toEqual([
            { table: 'image_generation_job', name: 'version', default: undefined },
            { table: 'image_generation_output', name: 'version', default: undefined },
            { table: 'referral_wallet_usage', name: 'version', default: undefined },
            { table: 'referral_program_config', name: 'currencyCode', default: undefined },
            { table: 'customer_coupon', name: 'currencyCode', default: undefined },
        ]);
        expect(dropIndex).toHaveBeenCalledOnce();
        expect(createIndex).toHaveBeenCalledOnce();
        const created = createIndex.mock.calls[0][1] as TableIndex;
        expect(created).toMatchObject({
            name: 'IDX_image_private_asset_storage_key',
            columnNames: ['storageKey'],
            isUnique: true,
        });
    });

    it('fails before rebuilding the unique index when duplicate keys exist', async () => {
        const tables = createTables();
        const dropIndex = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockResolvedValue([{ storageKey: 'duplicate', duplicateCount: 2 }]),
            dropIndex,
        } as unknown as QueryRunner;

        await expect(new AlignImageGenerationSchema1787803200000().up(queryRunner)).rejects.toThrow(
            'duplicate values exist',
        );
        expect(dropIndex).not.toHaveBeenCalled();
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignImageGenerationSchema1787803200000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
