import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddIcloudRelayTables1788750000000 } from './1788750000000-add-icloud-relay-tables';

describe('AddIcloudRelayTables migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates all 4 icloud relay tables on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(() => Promise.resolve(false)),
                createTable: vi.fn((table: Table) => {
                    createdTables.push(table);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddIcloudRelayTables1788750000000().up(queryRunner);

            expect(createdTables.map(t => t.name)).toEqual([
                'icloud_primary_account',
                'icloud_virtual_email',
                'icloud_received_mail',
                'icloud_query_audit_log',
            ]);

            const primaryTable = createdTables.find(t => t.name === 'icloud_primary_account');
            expect(primaryTable?.findColumnByName('encryptedAppPassword')).toMatchObject({ type: 'text' });
            expect(primaryTable?.findColumnByName('masterQueryCode')).toBeDefined();

            const virtualTable = createdTables.find(t => t.name === 'icloud_virtual_email');
            expect(virtualTable?.findColumnByName('buyerQueryCode')).toBeDefined();
            expect(virtualTable?.foreignKeys).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'FK_icloud_virtual_primary_account',
                        referencedTableName: 'icloud_primary_account',
                        onDelete: 'CASCADE',
                    }),
                ]),
            );

            const mailTable = createdTables.find(t => t.name === 'icloud_received_mail');
            expect(mailTable?.findColumnByName('extractedCode')).toBeDefined();
            expect(mailTable?.findColumnByName('receivedAt')).toBeDefined();
        },
    );

    it('does nothing when the tables already exist', async () => {
        const createTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(() => Promise.resolve(true)),
            createTable,
        } as unknown as QueryRunner;

        await new AddIcloudRelayTables1788750000000().up(queryRunner);

        expect(createTable).not.toHaveBeenCalled();
    });
});
