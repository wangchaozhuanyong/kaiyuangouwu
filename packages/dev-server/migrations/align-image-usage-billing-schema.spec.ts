import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignImageUsageBillingSchema1787853600000 } from './1787853600000-align-image-usage-billing-schema';

function createTables(termsDefault = "'2026-08-27'", versionDefault: number | null = 1) {
    return new Map<string, Table>([
        [
            'image_generation_config',
            new Table({
                name: 'image_generation_config',
                columns: [
                    {
                        name: 'termsVersion',
                        type: 'varchar',
                        length: '32',
                        isNullable: false,
                        default: termsDefault,
                    },
                ],
            }),
        ],
        [
            'image_usage_quota_bucket',
            new Table({
                name: 'image_usage_quota_bucket',
                columns: [
                    {
                        name: 'version',
                        type: 'int',
                        isNullable: false,
                        default: versionDefault ?? undefined,
                    },
                ],
            }),
        ],
    ]);
}

describe('image usage billing schema alignment', () => {
    it('aligns the MySQL terms default and version metadata', async () => {
        const tables = createTables();
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignImageUsageBillingSchema1787853600000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(2);
        const alignedColumns = changeColumn.mock.calls.map(call => {
            const [table, _current, aligned] = call as unknown as [Table, TableColumn, TableColumn];
            return {
                table: table.name,
                name: aligned.name,
                type: aligned.type,
                length: aligned.length,
                isNullable: aligned.isNullable,
                default: aligned.default,
            };
        });
        expect(alignedColumns).toEqual([
            {
                table: 'image_generation_config',
                name: 'termsVersion',
                type: 'varchar',
                length: '32',
                isNullable: false,
                default: "'2026-08-28-audit'",
            },
            {
                table: 'image_usage_quota_bucket',
                name: 'version',
                type: 'int',
                length: '',
                isNullable: false,
                default: undefined,
            },
        ]);
    });

    it('does not rewrite columns that already match the entities', async () => {
        const tables = createTables("'2026-08-28-audit'", null);
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignImageUsageBillingSchema1787853600000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignImageUsageBillingSchema1787853600000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
