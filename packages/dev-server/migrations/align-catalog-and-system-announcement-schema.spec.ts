import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignCatalogAndSystemAnnouncementSchema1787860800000 } from './1787860800000-align-catalog-and-system-announcement-schema';

function createTables({ aligned = false, includeObsoleteColumn = true } = {}) {
    return new Map<string, Table>([
        [
            'product',
            new Table({
                name: 'product',
                columns: [
                    {
                        name: 'customFieldsSourcecreatedat',
                        type: 'datetime',
                        precision: aligned ? 6 : undefined,
                        isNullable: true,
                    },
                ],
            }),
        ],
        [
            'system_announcement',
            new Table({
                name: 'system_announcement',
                columns: [
                    { name: 'id', type: 'int', isPrimary: true },
                    ...(includeObsoleteColumn
                        ? [{ name: 'targetMode', type: 'varchar', length: '255', isNullable: true }]
                        : []),
                ],
            }),
        ],
    ]);
}

describe('catalog and system announcement schema alignment', () => {
    it('aligns source date precision and removes the obsolete announcement field', async () => {
        const tables = createTables();
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const dropColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
            dropColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogAndSystemAnnouncementSchema1787860800000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledOnce();
        const [, current, expected] = changeColumn.mock.calls[0] as unknown as [
            Table,
            TableColumn,
            TableColumn,
        ];
        expect(current.name).toBe('customFieldsSourcecreatedat');
        expect(expected).toMatchObject({
            name: 'customFieldsSourcecreatedat',
            type: 'datetime',
            precision: 6,
            isNullable: true,
        });
        expect(dropColumn).toHaveBeenCalledOnce();
        expect((dropColumn.mock.calls[0] as unknown as [Table, TableColumn])[1].name).toBe('targetMode');
    });

    it('is idempotent when MySQL metadata is already aligned', async () => {
        const tables = createTables({ aligned: true, includeObsoleteColumn: false });
        const changeColumn = vi.fn();
        const dropColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mariadb' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
            dropColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogAndSystemAnnouncementSchema1787860800000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
        expect(dropColumn).not.toHaveBeenCalled();
    });

    it('does not alter the product column on non-MySQL databases but still removes obsolete fields', async () => {
        const tables = createTables();
        const changeColumn = vi.fn();
        const dropColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
            dropColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogAndSystemAnnouncementSchema1787860800000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
        expect(dropColumn).toHaveBeenCalledOnce();
    });
});
