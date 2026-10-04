import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ExpandIcloudMailBodies1791120600000 } from './1791120600000-expand-icloud-mail-bodies';

describe('lossless mail body capacity migration', () => {
    it.each(['mysql', 'mariadb'])(
        'widens in place on %s, retaining encoding, nullability and unrelated columns',
        async type => {
            const table = new Table({
                name: 'icloud_received_mail',
                columns: [
                    ...['bodyHtml', 'bodyText'].map(name => ({
                        name,
                        type: 'text',
                        isNullable: true,
                        charset: 'utf8mb4',
                        collation: 'utf8mb4_unicode_ci',
                    })),
                    { name: 'subject', type: 'varchar', length: '500' },
                ],
            });
            const query = vi.fn((sql: string) => {
                const name = sql.includes('`bodyHtml`') ? 'bodyHtml' : 'bodyText';
                const column = table.findColumnByName(name);
                if (!column) throw new Error('Missing fixture column');
                column.type = 'longtext';
                return Promise.resolve();
            });
            const runner = {
                connection: { options: { type } },
                getTable: () => Promise.resolve(table),
                query,
            } as unknown as QueryRunner;
            const migration = new ExpandIcloudMailBodies1791120600000();
            await migration.up(runner);
            await migration.up(runner);
            expect(query.mock.calls.map(([sql]) => sql)).toEqual([
                'ALTER TABLE `icloud_received_mail` MODIFY COLUMN `bodyHtml` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
                'ALTER TABLE `icloud_received_mail` MODIFY COLUMN `bodyText` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
            ]);
            expect(table.findColumnByName('subject')?.type).toBe('varchar');
        },
    );

    it.each(['postgres', 'sqlite', 'sqljs'])('leaves portable TEXT storage unchanged on %s', async type => {
        const query = vi.fn();
        await new ExpandIcloudMailBodies1791120600000().up({
            connection: { options: { type } },
            query,
        } as unknown as QueryRunner);
        expect(query).not.toHaveBeenCalled();
    });

    it('refuses a missing mail table instead of silently declaring success', async () => {
        await expect(
            new ExpandIcloudMailBodies1791120600000().up({
                connection: { options: { type: 'mysql' } },
                getTable: () => Promise.resolve(undefined),
            } as unknown as QueryRunner),
        ).rejects.toThrow('requires icloud_received_mail');
    });

    it('refuses a shrinking rollback that could discard large mail bodies', async () => {
        await expect(new ExpandIcloudMailBodies1791120600000().down()).rejects.toThrow('forward migration');
    });
});
