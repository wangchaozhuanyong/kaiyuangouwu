import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignImageUsageSchema1787853600000 } from './1787853600000-align-image-usage-schema';

function createTables(
    termsDefault: string | number | boolean | null | undefined = "'2026-08-27'",
    versionDefault: string | number | boolean | null | undefined = 1,
) {
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
                        default: versionDefault,
                    },
                ],
            }),
        ],
    ]);
}

function mysqlQueryRunner(tables: Map<string, Table>) {
    const changeColumn = vi.fn().mockResolvedValue(undefined);
    const getTable = vi.fn((name: string) => Promise.resolve(tables.get(name)));
    const queryRunner = {
        connection: { options: { type: 'mysql' } },
        getTable,
        changeColumn,
    } as unknown as QueryRunner;

    return { changeColumn, getTable, queryRunner };
}

describe('image usage schema alignment', () => {
    it('aligns the MySQL terms default and optimistic-lock version column', async () => {
        const { changeColumn, queryRunner } = mysqlQueryRunner(createTables());

        await new AlignImageUsageSchema1787853600000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(2);
        const aligned = changeColumn.mock.calls.map(call => {
            const [table, _current, column] = call as unknown as [Table, TableColumn, TableColumn];
            return { table: table.name, name: column.name, default: column.default };
        });
        expect(aligned).toEqual([
            {
                table: 'image_generation_config',
                name: 'termsVersion',
                default: "'2026-08-28-audit'",
            },
            { table: 'image_usage_quota_bucket', name: 'version', default: undefined },
        ]);
    });

    it('is idempotent when the MySQL columns are already aligned', async () => {
        const { changeColumn, queryRunner } = mysqlQueryRunner(
            createTables("'2026-08-28-audit'", null),
        );

        await new AlignImageUsageSchema1787853600000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });

    it('restores the previous MySQL defaults on rollback', async () => {
        const { changeColumn, queryRunner } = mysqlQueryRunner(
            createTables("'2026-08-28-audit'", null),
        );

        await new AlignImageUsageSchema1787853600000().down(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(2);
        const defaults = changeColumn.mock.calls.map(
            call => (call[2] as unknown as TableColumn).default,
        );
        expect(defaults).toEqual(["'2026-08-27'", 1]);
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignImageUsageSchema1787853600000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
