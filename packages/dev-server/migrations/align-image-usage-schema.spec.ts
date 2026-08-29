import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignImageUsageSchema1787853600000 } from './1787853600000-align-image-usage-schema';

describe('align image usage schema migration', () => {
    it('aligns legacy MySQL defaults without issuing data mutations', async () => {
        const configTable = tableWithColumn('image_generation_config', {
            name: 'termsVersion',
            type: 'varchar',
            length: '32',
            default: "'2026-08-27'",
        });
        const quotaTable = tableWithColumn('image_usage_quota_bucket', {
            name: 'version',
            type: 'int',
            default: '1',
        });
        const changedColumns: Array<{ table: string; column: string; defaultValue: unknown }> = [];
        const query = vi.fn();
        const queryRunner = mysqlQueryRunner(
            tableName => (tableName === configTable.name ? configTable : quotaTable),
            (table, _current, aligned) => {
                changedColumns.push({
                    table: table.name,
                    column: aligned.name,
                    defaultValue: aligned.default,
                });
            },
            query,
        );

        await new AlignImageUsageSchema1787853600000().up(queryRunner);

        expect(changedColumns).toEqual([
            {
                table: 'image_generation_config',
                column: 'termsVersion',
                defaultValue: "'2026-08-28-audit'",
            },
            {
                table: 'image_usage_quota_bucket',
                column: 'version',
                defaultValue: undefined,
            },
        ]);
        expect(query).not.toHaveBeenCalled();
    });

    it('does nothing when MySQL defaults are already aligned', async () => {
        const configTable = tableWithColumn('image_generation_config', {
            name: 'termsVersion',
            type: 'varchar',
            length: '32',
            default: "('2026-08-28-audit')",
        });
        const quotaTable = tableWithColumn('image_usage_quota_bucket', {
            name: 'version',
            type: 'int',
        });
        const changeColumn = vi.fn();
        const queryRunner = mysqlQueryRunner(
            tableName => (tableName === configTable.name ? configTable : quotaTable),
            changeColumn,
        );

        await new AlignImageUsageSchema1787853600000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });

    it('skips missing tables and non-MySQL databases', async () => {
        const changeColumn = vi.fn();
        const missingTableRunner = mysqlQueryRunner(() => undefined, changeColumn);
        await new AlignImageUsageSchema1787853600000().up(missingTableRunner);
        expect(changeColumn).not.toHaveBeenCalled();

        const getTable = vi.fn();
        const postgresRunner = {
            connection: { options: { type: 'postgres' } },
            getTable,
        } as unknown as QueryRunner;
        await new AlignImageUsageSchema1787853600000().up(postgresRunner);
        expect(getTable).not.toHaveBeenCalled();
    });
});

function tableWithColumn(tableName: string, column: ConstructorParameters<typeof TableColumn>[0]): Table {
    return new Table({ name: tableName, columns: [column] });
}

function mysqlQueryRunner(
    getTable: (tableName: string) => Table | undefined,
    onChange: (table: Table, current: TableColumn, aligned: TableColumn) => void,
    query = vi.fn(),
): QueryRunner {
    return {
        connection: { options: { type: 'mysql' } },
        getTable: vi.fn(tableName => Promise.resolve(getTable(tableName))),
        changeColumn: vi.fn((table: Table, current: TableColumn, aligned: TableColumn) => {
            onChange(table, current, aligned);
            return Promise.resolve();
        }),
        query,
    } as unknown as QueryRunner;
}
