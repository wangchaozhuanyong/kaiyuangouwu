import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ScopeSystemAnnouncements1787878800000 } from './1787878800000-scope-system-announcements';
import { AddChannelUsdtWallets1787882400000 } from './1787882400000-add-channel-usdt-wallets';
import { AddUsdtManualRefunds1787886000000 } from './1787886000000-add-usdt-manual-refunds';
import { AlignChannelUsdtSchema1787889600000 } from './1787889600000-align-channel-usdt-schema';

const mysqlTestSocket = process.env.TEST_MYSQL_SOCKET ?? '';
const mysqlTestHost = process.env.TEST_MYSQL_HOST ?? '';
const mysqlTestPort = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const mysqlTestPassword = process.env.TEST_MYSQL_PASSWORD ?? '';

describe('Channel announcements, USDT wallets and refund audit migrations', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'derives portable relation ID columns for Channel announcements on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const addedColumns: TableColumn[] = [];
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const tables = new Map([
                ['system_announcement', idTable('system_announcement', idType)],
                ['channel', idTable('channel', idType)],
            ]);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(async (name: string) => tables.get(name)),
                hasTable: vi.fn(async () => false),
                addColumn: vi.fn(async (_table: Table, column: TableColumn) => addedColumns.push(column)),
                createTable: vi.fn(async (table: Table) => createdTables.push(table)),
            } as unknown as QueryRunner;

            await new ScopeSystemAnnouncements1787878800000().up(queryRunner);

            expect(addedColumns[0]).toMatchObject({
                name: 'targetMode',
                type: 'varchar',
                default: "'ALL'",
            });
            expect(createdTables[0]?.name).toBe('system_announcement_channels_channel');
            expect(createdTables[0]?.findColumnByName('channelId')?.type).toBe(idType);
            expect(createdTables[0]?.foreignKeys).toHaveLength(2);
        },
    );

    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates encrypted wallet, audit and exact refund evidence schema on %s',
        async databaseType => {
            const createdTables: Table[] = [];
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const baseTables = new Map(
                ['channel', 'user', 'payment', 'order', 'refund'].map(name => [name, idTable(name, idType)]),
            );
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(async (name: string) => baseTables.get(name)),
                hasTable: vi.fn(async () => false),
                createTable: vi.fn(async (table: Table) => createdTables.push(table)),
            } as unknown as QueryRunner;

            await new AddChannelUsdtWallets1787882400000().up(queryRunner);
            await new AddUsdtManualRefunds1787886000000().up(queryRunner);

            const wallet = createdTables.find(table => table.name === 'store_usdt_wallet');
            const audit = createdTables.find(table => table.name === 'store_usdt_wallet_audit');
            const refund = createdTables.find(table => table.name === 'store_usdt_manual_refund');
            expect(wallet?.findColumnByName('activeReceivingAddressEncrypted')).toMatchObject({
                type: 'text',
                isNullable: true,
            });
            expect(wallet?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_store_usdt_wallet_channel', isUnique: true }),
                ]),
            );
            expect(audit?.findColumnByName('addressFingerprint')).toMatchObject({
                type: 'varchar',
                length: '64',
            });
            expect(refund?.findColumnByName('usdtAmountBaseUnits')).toMatchObject({
                type: 'decimal',
                precision: 30,
                scale: 0,
            });
            expect(
                refund?.indices.find(index => index.name === 'IDX_store_usdt_manual_refund_transaction'),
            ).toMatchObject({ isUnique: true });
            expect(refund?.foreignKeys).toHaveLength(4);
        },
    );

    it('applies, enforces uniqueness and rolls back against a real SQL.js database', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            for (const tableName of ['channel', 'user', 'payment', 'order', 'refund']) {
                await queryRunner.createTable(idTable(tableName, 'integer'));
            }
            await queryRunner.createTable(idTable('system_announcement', 'integer'));
            const announcementMigration = new ScopeSystemAnnouncements1787878800000();
            const walletMigration = new AddChannelUsdtWallets1787882400000();
            const refundMigration = new AddUsdtManualRefunds1787886000000();
            const alignmentMigration = new AlignChannelUsdtSchema1787889600000();

            await announcementMigration.up(queryRunner);
            await walletMigration.up(queryRunner);
            await refundMigration.up(queryRunner);
            await alignmentMigration.up(queryRunner);

            const joinTable = await queryRunner.getTable('system_announcement_channels_channel');
            expect(joinTable?.indices.map(index => index.name)).toEqual(
                expect.arrayContaining(['IDX_aa074cb9061687d3e3b2bc7fc8', 'IDX_adcdad637ed68b4349d68d6a6c']),
            );
            expect(joinTable?.indices.map(index => index.name)).not.toEqual(
                expect.arrayContaining([
                    'IDX_system_announcement_channels_announcement',
                    'IDX_system_announcement_channels_channel',
                ]),
            );

            expect(
                (await queryRunner.getTable('system_announcement'))?.findColumnByName('targetMode'),
            ).toBeDefined();
            await queryRunner.query('INSERT INTO "channel" DEFAULT VALUES');
            await queryRunner.query('INSERT INTO "user" DEFAULT VALUES');
            await queryRunner.query('INSERT INTO "payment" DEFAULT VALUES');
            await queryRunner.query('INSERT INTO "order" DEFAULT VALUES');
            await queryRunner.query('INSERT INTO "refund" DEFAULT VALUES');
            await queryRunner.query('INSERT INTO "store_usdt_wallet" ("channelId") VALUES (1)');
            await expect(
                queryRunner.query('INSERT INTO "store_usdt_wallet" ("channelId") VALUES (1)'),
            ).rejects.toThrow();

            const refundValues = [
                1,
                1,
                1,
                1,
                'TRC20',
                'b'.repeat(64),
                '3250000',
                'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
                'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
                88_000_001,
                '2026-08-29 10:00:00',
                1,
                '客户申请退款',
            ];
            const insertRefund = () =>
                queryRunner.query(
                    `INSERT INTO "store_usdt_manual_refund"
                        ("channelId", "paymentId", "orderId", "refundId", "network",
                         "transactionId", "usdtAmountBaseUnits", "fromAddress", "toAddress",
                         "blockNumber", "blockTimestamp", "operatorUserId", "reason")
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    refundValues,
                );
            await insertRefund();
            await expect(insertRefund()).rejects.toThrow();

            await alignmentMigration.down(queryRunner);
            const rolledBackJoinTable = await queryRunner.getTable('system_announcement_channels_channel');
            expect(rolledBackJoinTable?.indices.map(index => index.name)).toEqual(
                expect.arrayContaining([
                    'IDX_system_announcement_channels_announcement',
                    'IDX_system_announcement_channels_channel',
                ]),
            );
            await refundMigration.down(queryRunner);
            await walletMigration.down(queryRunner);
            await announcementMigration.down(queryRunner);
            await expect(queryRunner.hasTable('store_usdt_manual_refund')).resolves.toBe(false);
            await expect(queryRunner.hasTable('store_usdt_wallet')).resolves.toBe(false);
            await expect(queryRunner.hasTable('store_usdt_wallet_audit')).resolves.toBe(false);
            await expect(queryRunner.hasTable('system_announcement_channels_channel')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });

    it('creates replacement indexes before dropping MySQL foreign-key backing indexes', async () => {
        const calls: string[] = [];
        const table = new Table({
            name: 'system_announcement_channels_channel',
            columns: [
                { name: 'systemAnnouncementId', type: 'int', isPrimary: true },
                { name: 'channelId', type: 'int', isPrimary: true },
            ],
            indices: [
                {
                    name: 'IDX_aa074cb9061687d3e3b2bc7fc8',
                    columnNames: ['systemAnnouncementId'],
                },
                {
                    name: 'IDX_system_announcement_channels_channel',
                    columnNames: ['channelId'],
                },
            ],
        });
        const queryRunner = {
            getTable: vi.fn().mockResolvedValue(table),
            createIndex: vi.fn(async (_tableName: string, index: { name?: string }) => {
                calls.push(`create:${index.name}`);
            }),
            dropIndex: vi.fn(async (_tableName: string, index: { name?: string }) => {
                calls.push(`drop:${index.name}`);
            }),
        } as unknown as QueryRunner;

        await new AlignChannelUsdtSchema1787889600000().up(queryRunner);

        expect(calls).toEqual([
            'create:IDX_adcdad637ed68b4349d68d6a6c',
            'drop:IDX_system_announcement_channels_channel',
        ]);
    });

    it.runIf(Boolean(mysqlTestSocket || mysqlTestHost))(
        'applies, enforces uniqueness and rolls back against an isolated real MySQL database',
        async () => {
            const dataSource = new DataSource({
                type: 'mysql',
                ...(mysqlTestHost ? { host: mysqlTestHost, port: mysqlTestPort } : {}),
                username: 'root',
                password: mysqlTestPassword,
                database: 'codex_usdt_migration_test',
                ...(mysqlTestSocket ? { extra: { socketPath: mysqlTestSocket } } : {}),
                entities: [],
                synchronize: false,
            });
            await dataSource.initialize();
            const queryRunner = dataSource.createQueryRunner();
            try {
                for (const tableName of ['channel', 'user', 'payment', 'order', 'refund']) {
                    await queryRunner.createTable(idTable(tableName, 'int'));
                }
                await queryRunner.createTable(idTable('system_announcement', 'int'));
                const announcementMigration = new ScopeSystemAnnouncements1787878800000();
                const walletMigration = new AddChannelUsdtWallets1787882400000();
                const refundMigration = new AddUsdtManualRefunds1787886000000();
                const alignmentMigration = new AlignChannelUsdtSchema1787889600000();

                await announcementMigration.up(queryRunner);
                await walletMigration.up(queryRunner);
                await refundMigration.up(queryRunner);
                await alignmentMigration.up(queryRunner);

                const joinTable = await queryRunner.getTable('system_announcement_channels_channel');
                expect(joinTable?.indices.map(index => index.name)).toEqual(
                    expect.arrayContaining([
                        'IDX_aa074cb9061687d3e3b2bc7fc8',
                        'IDX_adcdad637ed68b4349d68d6a6c',
                    ]),
                );

                await queryRunner.query('INSERT INTO `channel` VALUES ()');
                await queryRunner.query('INSERT INTO `user` VALUES ()');
                await queryRunner.query('INSERT INTO `payment` VALUES ()');
                await queryRunner.query('INSERT INTO `order` VALUES ()');
                await queryRunner.query('INSERT INTO `refund` VALUES ()');
                await queryRunner.query('INSERT INTO `store_usdt_wallet` (`channelId`) VALUES (1)');
                await expect(
                    queryRunner.query('INSERT INTO `store_usdt_wallet` (`channelId`) VALUES (1)'),
                ).rejects.toThrow();

                const insertRefund = () =>
                    queryRunner.query(
                        `INSERT INTO \`store_usdt_manual_refund\`
                            (\`channelId\`, \`paymentId\`, \`orderId\`, \`refundId\`, \`network\`,
                             \`transactionId\`, \`usdtAmountBaseUnits\`, \`fromAddress\`, \`toAddress\`,
                             \`blockNumber\`, \`blockTimestamp\`, \`operatorUserId\`, \`reason\`)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            1,
                            1,
                            1,
                            1,
                            'TRC20',
                            'b'.repeat(64),
                            '3250000',
                            'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
                            'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
                            88_000_001,
                            '2026-08-29 10:00:00',
                            1,
                            '客户申请退款',
                        ],
                    );
                await insertRefund();
                await expect(insertRefund()).rejects.toThrow();

                await alignmentMigration.down(queryRunner);
                const rolledBackJoinTable = await queryRunner.getTable(
                    'system_announcement_channels_channel',
                );
                expect(rolledBackJoinTable?.indices.map(index => index.name)).toEqual(
                    expect.arrayContaining([
                        'IDX_system_announcement_channels_announcement',
                        'IDX_system_announcement_channels_channel',
                    ]),
                );
                await refundMigration.down(queryRunner);
                await walletMigration.down(queryRunner);
                await announcementMigration.down(queryRunner);
                await expect(queryRunner.hasTable('store_usdt_manual_refund')).resolves.toBe(false);
                await expect(queryRunner.hasTable('store_usdt_wallet')).resolves.toBe(false);
                await expect(queryRunner.hasTable('system_announcement_channels_channel')).resolves.toBe(
                    false,
                );
            } finally {
                await queryRunner.release();
                await dataSource.destroy();
            }
        },
        30_000,
    );
});

function idTable(name: string, type: string): Table {
    return new Table({
        name,
        columns: [
            {
                name: 'id',
                type,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            },
        ],
    });
}
