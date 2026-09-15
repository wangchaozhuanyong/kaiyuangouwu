import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner, Table } from 'typeorm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { AlignCatalogImportPreviewTimestamps1789387200000 } from './1789387200000-align-catalog-import-preview-timestamps';
import { AddOrderSalesChannel1789390800000 } from './1789390800000-add-order-sales-channel';
import { AddCustomerIdentityKey1789394400000 } from './1789394400000-add-customer-identity-key';
import { AddCustomerGroupChannel1789398000000 } from './1789398000000-add-customer-group-channel';
import { AddCustomerStoreEntry1789401600000 } from './1789401600000-add-customer-store-entry';

// This disposable database is created only on the local synthetic MySQL container.
const database = `e2e_catalog_precision_${randomUUID().replaceAll('-', '')}`;
let admin: DataSource;
let connection: DataSource;
let runner: QueryRunner;
beforeAll(async () => {
    const port = Number(process.env.E2E_MYSQL_PORT);
    if (process.env.CI !== '1' || !Number.isInteger(port) || port <= 0)
        throw new Error('This rehearsal requires an explicit isolated local MySQL test port');
    const options = {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port,
        username: 'root',
        password: process.env.E2E_MYSQL_PASSWORD ?? 'password',
    };
    admin = await new DataSource(options).initialize();
    await admin.query(`CREATE DATABASE \`${database}\``);
    connection = await new DataSource({ ...options, database }).initialize();
    runner = connection.createQueryRunner();
    for (const table of ['customer_store_entry', 'customer_group', 'customer', 'user'])
        await runner.dropTable(table, true);
    await runner.dropTable('catalog_import_row', true);
    await runner.createTable(
        new Table({
            name: 'catalog_import_row',
            columns: [
                { name: 'id', type: 'int', isPrimary: true },
                { name: 'expectedProductUpdatedAt', type: 'datetime', precision: 0, isNullable: true },
                { name: 'expectedVariantUpdatedAt', type: 'datetime', precision: 0, isNullable: true },
            ],
        }),
    );
    await runner.query("INSERT INTO catalog_import_row VALUES (1, '2026-09-14 01:02:03', NULL)");
});
afterAll(async () => {
    await runner?.release();
    await connection?.destroy();
    if (admin?.isInitialized) {
        await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await admin.destroy();
    }
});

it('preserves old values and nulls, stores new fractional values, and safely re-enters after partial DDL', async () => {
    // Model an interrupted migration after the first ALTER TABLE committed.
    await runner.query('ALTER TABLE catalog_import_row MODIFY expectedProductUpdatedAt datetime(6) NULL');
    const migration = new AlignCatalogImportPreviewTimestamps1789387200000();
    await migration.up(runner);
    await migration.up(runner);
    const table = await runner.getTable('catalog_import_row');
    expect(table?.columns.filter(column => column.name !== 'id').map(column => column.precision)).toEqual([
        6, 6,
    ]);
    await runner.query(
        "INSERT INTO catalog_import_row VALUES (2, '2026-09-14 01:02:03.123456', '2026-09-14 01:02:03.654321')",
    );
    const rows = await runner.query(
        'SELECT id, CAST(expectedProductUpdatedAt AS CHAR) AS productVersion, ' +
            'CAST(expectedVariantUpdatedAt AS CHAR) AS variantVersion FROM catalog_import_row ORDER BY id',
    );
    expect(rows).toEqual([
        { id: 1, productVersion: '2026-09-14 01:02:03.000000', variantVersion: null },
        { id: 2, productVersion: '2026-09-14 01:02:03.123456', variantVersion: '2026-09-14 01:02:03.654321' },
    ]);
    await expect(migration.down(runner)).rejects.toThrow('without losing');
    expect(
        await runner.query(
            'SELECT id, CAST(expectedProductUpdatedAt AS CHAR) AS productVersion, ' +
                'CAST(expectedVariantUpdatedAt AS CHAR) AS variantVersion FROM catalog_import_row ORDER BY id',
        ),
    ).toEqual(rows);
});

it('adds sale ownership without guessing historical owners and preserves it on rollback', async () => {
    await runner.dropTable('order', true);
    await runner.dropTable('channel', true);
    await runner.createTable(
        new Table({ name: 'channel', columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
    );
    await runner.createTable(
        new Table({ name: 'order', columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
    );
    await runner.query('INSERT INTO channel VALUES (1), (2)');
    await runner.query('INSERT INTO `order` VALUES (1)');
    const migration = new AddOrderSalesChannel1789390800000();
    await migration.up(runner);
    await migration.up(runner);
    expect(await runner.query('SELECT * FROM `order`')).toEqual([{ id: 1, salesChannelId: null }]);
    await runner.query('INSERT INTO `order` VALUES (2, 2)');
    await expect(runner.query('INSERT INTO `order` VALUES (3, 999)')).rejects.toThrow();
    await expect(runner.query('DELETE FROM channel WHERE id = 2')).rejects.toThrow();
    await expect(migration.down()).rejects.toThrow('Retain order sales ownership');
    expect(await runner.query('SELECT * FROM `order` ORDER BY id')).toEqual([
        { id: 1, salesChannelId: null },
        { id: 2, salesChannelId: 2 },
    ]);
});

it('adds identity, group ownership and entry history without inventing legacy provenance', async () => {
    await runner.createTable(
        new Table({ name: 'user', columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
    );
    await runner.createTable(
        new Table({ name: 'customer_group', columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
    );
    await runner.createTable(
        new Table({
            name: 'customer',
            columns: [
                {
                    name: 'id',
                    type: 'int',
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: 'increment',
                },
            ],
        }),
    );
    await runner.query('INSERT INTO user VALUES (1), (2)');
    await runner.query('INSERT INTO customer VALUES (1), (2)');
    await runner.query('INSERT INTO customer_group VALUES (1)');
    const identity = new AddCustomerIdentityKey1789394400000();
    const group = new AddCustomerGroupChannel1789398000000();
    const entry = new AddCustomerStoreEntry1789401600000();
    for (const migration of [identity, group, entry]) {
        await migration.up(runner);
        await migration.up(runner);
    }
    expect(await runner.query('SELECT * FROM user')).toEqual([
        { id: 1, customerIdentifier: null },
        { id: 2, customerIdentifier: null },
    ]);
    expect(await runner.query('SELECT * FROM customer_group')).toEqual([{ id: 1, channelId: null }]);
    expect(await runner.query('SELECT * FROM customer_store_entry')).toEqual([]);
    await runner.query("UPDATE user SET customerIdentifier = 'one@example.test' WHERE id = 1");
    await expect(
        runner.query("UPDATE user SET customerIdentifier = 'one@example.test' WHERE id = 2"),
    ).rejects.toThrow();
    await runner.query(
        "INSERT INTO customer_store_entry (customerId, channelId, firstSeenAt, source) VALUES (1, 2, NULL, 'LEGACY_UNRESOLVED')",
    );
    await expect(
        runner.query(
            "INSERT INTO customer_store_entry (customerId, channelId, firstSeenAt, source) VALUES (1, 2, NOW(), 'AUTHENTICATED_ENTRY')",
        ),
    ).rejects.toThrow();
    await expect(
        runner.query(
            "INSERT INTO customer_store_entry (customerId, channelId, source) VALUES (999, 2, 'REGISTRATION')",
        ),
    ).rejects.toThrow();
    await expect(runner.query('UPDATE customer_group SET channelId = 999')).rejects.toThrow();
    for (const migration of [identity, group, entry])
        await expect(migration.down()).rejects.toThrow('Retain');
});
