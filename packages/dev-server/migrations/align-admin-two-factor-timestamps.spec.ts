import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignAdminTwoFactorTimestamps1788613200000 } from './1788613200000-align-admin-two-factor-timestamps';

describe('administrator 2FA timestamp alignment', () => {
    it.each(['mysql', 'mariadb'])(
        'preserves column attributes and supports retry and rollback on %s',
        async type => {
            const tables = new Map<string, Table>();
            const changeColumn = vi.fn((table: Table, _before: TableColumn, after: TableColumn) => {
                table.columns = [after];
                return Promise.resolve();
            });
            const runner = {
                connection: { options: { type } },
                getTable: vi.fn((name: string) => {
                    if (!tables.has(name)) {
                        tables.set(
                            name,
                            new Table({
                                name,
                                columns: [
                                    {
                                        name: 'updatedAt',
                                        type: 'datetime',
                                        precision: 6,
                                        default: 'CURRENT_TIMESTAMP(6)',
                                    },
                                ],
                            }),
                        );
                    }
                    return Promise.resolve(tables.get(name));
                }),
                changeColumn,
            } as unknown as QueryRunner;
            const migration = new AlignAdminTwoFactorTimestamps1788613200000();
            await migration.up(runner);
            expect(changeColumn).toHaveBeenCalledTimes(4);
            for (const table of tables.values()) {
                expect(table.columns[0]).toMatchObject({
                    type: 'datetime',
                    precision: 6,
                    default: 'CURRENT_TIMESTAMP(6)',
                    onUpdate: 'CURRENT_TIMESTAMP(6)',
                });
            }
            await migration.up(runner);
            expect(changeColumn).toHaveBeenCalledTimes(4);
            await migration.down(runner);
            expect(changeColumn).toHaveBeenCalledTimes(8);
            expect([...tables.values()].every(table => table.columns[0].onUpdate === undefined)).toBe(true);
            await migration.down(runner);
            expect(changeColumn).toHaveBeenCalledTimes(8);
            await migration.up(runner);
            expect(changeColumn).toHaveBeenCalledTimes(12);
        },
    );

    it.each(['postgres', 'sqljs'])('leaves %s timestamp semantics unchanged', async type => {
        const getTable = vi.fn();
        const runner = { connection: { options: { type } }, getTable } as unknown as QueryRunner;
        const migration = new AlignAdminTwoFactorTimestamps1788613200000();
        await migration.up(runner);
        await migration.down(runner);
        expect(getTable).not.toHaveBeenCalled();
    });

    it('fails closed when a security table is missing', async () => {
        const runner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(undefined),
        } as unknown as QueryRunner;
        await expect(new AlignAdminTwoFactorTimestamps1788613200000().up(runner)).rejects.toThrow(
            'must exist',
        );
    });
});
