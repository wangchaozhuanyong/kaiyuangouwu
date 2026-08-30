import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ScopeSystemAnnouncements1787799600000 } from './1787799600000-scope-system-announcements';
import { AddChannelUsdtWallets1787803200000 } from './1787803200000-add-channel-usdt-wallets';

describe('Channel-scoped announcements and USDT wallets migrations', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable Channel announcement targeting on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const addedColumns: TableColumn[] = [];
            const announcementTable = new Table({
                name: 'system_announcement',
                columns: [{ name: 'id', type: databaseType === 'mysql' ? 'int' : 'integer' }],
            });
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn((name: string) => Promise.resolve(name === 'system_announcement')),
                getTable: vi.fn(() => Promise.resolve(announcementTable)),
                addColumn: vi.fn((_table: string, column: TableColumn) =>
                    Promise.resolve(addedColumns.push(column)),
                ),
                createTable: vi.fn((table: Table) => Promise.resolve(createdTables.push(table))),
            } as unknown as QueryRunner;

            await new ScopeSystemAnnouncements1787799600000().up(queryRunner);

            expect(addedColumns[0]).toMatchObject({
                name: 'targetMode',
                type: 'varchar',
                default: "'ALL'",
            });
            expect(createdTables[0]?.name).toBe('system_announcement_channels_channel');
            expect(createdTables[0]?.foreignKeys).toHaveLength(2);
            expect(createdTables[0]?.findColumnByName('channelId')?.type).toBe(
                databaseType === 'mysql' ? 'int' : 'integer',
            );
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates encrypted per-Channel USDT wallet storage on %s',
        async databaseType => {
            let created: Table | undefined;
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(() => Promise.resolve(false)),
                createTable: vi.fn((table: Table) => {
                    created = table;
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddChannelUsdtWallets1787803200000().up(queryRunner);

            expect(created?.name).toBe('store_usdt_wallet');
            expect(created?.findColumnByName('activeReceivingAddressEncrypted')).toMatchObject({
                type: 'text',
                isNullable: true,
            });
            expect(created?.findColumnByName('pendingReceivingAddressEncrypted')?.type).toBe('text');
            expect(created?.findColumnByName('channelId')?.type).toBe(
                databaseType === 'mysql' ? 'int' : 'integer',
            );
            expect(created?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_store_usdt_wallet_channel', isUnique: true }),
                ]),
            );
            expect(created?.foreignKeys).toHaveLength(1);
        },
    );
});
