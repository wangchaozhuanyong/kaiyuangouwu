import { QueryRunner, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignIcloudRelaySchema1788751000000 } from './1788751000000-align-icloud-relay-schema';

describe('AlignIcloudRelaySchema migration', () => {
    it('adds missing mailCount, lastMailReceivedAt and isStarred columns', async () => {
        const addedColumns: Array<{ table: string; column: TableColumn }> = [];
        const existingColumns = new Set<string>();

        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(() => Promise.resolve(true)),
            hasColumn: vi.fn((table: string, column: string) =>
                Promise.resolve(existingColumns.has(`${table}.${column}`)),
            ),
            addColumn: vi.fn((table: string, column: TableColumn) => {
                addedColumns.push({ table, column });
                existingColumns.add(`${table}.${column.name}`);
                return Promise.resolve();
            }),
        } as unknown as QueryRunner;

        await new AlignIcloudRelaySchema1788751000000().up(queryRunner);

        expect(addedColumns).toEqual([
            expect.objectContaining({
                table: 'icloud_virtual_email',
                column: expect.objectContaining({ name: 'mailCount', type: 'int', default: 0 }),
            }),
            expect.objectContaining({
                table: 'icloud_virtual_email',
                column: expect.objectContaining({ name: 'lastMailReceivedAt', isNullable: true }),
            }),
            expect.objectContaining({
                table: 'icloud_received_mail',
                column: expect.objectContaining({ name: 'isStarred' }),
            }),
        ]);
    });

    it('is idempotent when columns already exist', async () => {
        const addColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(() => Promise.resolve(true)),
            hasColumn: vi.fn(() => Promise.resolve(true)),
            addColumn,
        } as unknown as QueryRunner;

        await new AlignIcloudRelaySchema1788751000000().up(queryRunner);

        expect(addColumn).not.toHaveBeenCalled();
    });
});
