import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    buildStoreIsolationPreflight,
    collectStoreIsolationSnapshot,
    createReadOnlyMysqlAdapter,
    scanDigitalDeliveryRoot,
    summarizeStockOwnership,
} from './store-isolation-data-preflight.mjs';

async function fixtureDirectory() {
    const parent = new URL('../../../reports/pending-migrations-20260913/fixtures/', import.meta.url);
    await mkdir(parent, { recursive: true });
    return mkdtemp(path.join(fileURLToPath(parent), 'preflight-'));
}

test('buildStoreIsolationPreflight reports pseudonymous migration blockers', () => {
    const empty = { available: true, shared: [] };
    const snapshot = {
        channels: [
            { id: '1', code: '__default_channel__' },
            { id: '2', code: 'store-b' },
        ],
        associations: {
            customers: {
                available: true,
                shared: [{ entityId: 10, label: null, channelIds: ['1', '2'] }],
            },
            stockLocations: {
                available: true,
                shared: [{ entityId: 20, label: 'Shared warehouse', channelIds: ['1', '2'] }],
            },
            paymentMethods: empty,
            shippingMethods: empty,
            products: empty,
            productVariants: empty,
            collections: empty,
            sellers: {
                available: true,
                shared: [{ entityId: 30, label: 'Shared seller', channelIds: ['1', '2'] }],
            },
        },
        customerDetails: [{ customerId: 10, addressCount: 2, orders: [{ channelId: '2', count: 3 }] }],
        stockLocationDetails: [
            { stockLocationId: 20, stockLevelCount: 4, stockMovementCount: 5, variantCount: 3 },
        ],
        icloud: [
            {
                tableName: 'icloud_primary_account',
                exists: true,
                hasChannelId: false,
                totalRows: 2,
                unscopedRows: 2,
            },
        ],
        digitalDelivery: {
            configured: true,
            exists: true,
            root: '/private/delivery',
            legacyFiles: [{ name: 'sku.zip', bytes: 100 }],
            channelDirectories: [],
        },
    };

    const report = buildStoreIsolationPreflight(snapshot, 'test-audit-key');

    assert.equal(report.mode, 'read-only');
    assert.equal(report.associations.customers.sharedCount, 1);
    assert.match(report.associations.customers.shared[0].entityRef, /^[a-f0-9]{16}$/u);
    assert.equal(report.associations.customers.shared[0].addressCount, 2);
    assert.deepEqual(report.associations.customers.shared[0].orders, [
        { channelId: '2', channelCode: 'store-b', count: 3 },
    ]);
    assert.equal(report.associations.stockLocations.shared[0].stockMovementCount, 5);
    assert.deepEqual(report.blockers, {
        sharedCustomers: 1,
        sharedStockLocations: 1,
        sharedPaymentMethods: 0,
        sharedShippingMethods: 0,
        sharedProducts: 0,
        sharedProductVariants: 0,
        sharedSellers: 1,
        unscopedIcloudRows: 0,
        unsafeLegacyDigitalFiles: 0,
        legacyDigitalFiles: 1,
    });
    assert.equal(report.digitalDelivery.oldTokenCount, null);
    assert.match(report.digitalDelivery.legacyFiles[0].fileRef, /^[a-f0-9]{16}$/u);
    assert.deepEqual(
        { ...report.digitalDelivery.legacyFiles[0], fileRef: '<redacted>' },
        {
            fileRef: '<redacted>',
            fileName: 'sku.zip',
            extension: '.zip',
            bytes: 100,
            sha256: null,
            candidateChannelIds: [],
        },
    );
    assert.equal('name' in report.digitalDelivery.legacyFiles[0], false);
    assert.deepEqual(report.sharedResources.icloud, { policy: 'platform-shared', legacyRows: 2 });
    assert.equal(report.icloud[0].unscopedRows, 2);
});

test('scanDigitalDeliveryRoot separates legacy top-level files from Channel directories', async () => {
    const root = await fixtureDirectory();
    try {
        await writeFile(path.join(root, 'legacy.zip'), 'legacy');
        await mkdir(path.join(root, 'channel-1'));
        await writeFile(path.join(root, 'channel-1', 'isolated.zip'), 'isolated');

        const result = await scanDigitalDeliveryRoot(root);

        assert.deepEqual(result.legacyFiles, [
            { name: 'legacy.zip', bytes: 6, sha256: createHash('sha256').update('legacy').digest('hex') },
        ]);
        assert.deepEqual(result.channelDirectories, [{ channelId: 'channel-1', fileCount: 1 }]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('stock joins count a shared variant once and preserve ambiguous ownership without copying quantities', () => {
    const rows = [
        { productVariantId: 1, channelId: 1, stockOnHand: 7, stockAllocated: 2 },
        { productVariantId: 1, channelId: 2, stockOnHand: 7, stockAllocated: 2 },
        { productVariantId: 2, channelId: 2, stockOnHand: 3, stockAllocated: 1 },
    ];
    assert.deepEqual(summarizeStockOwnership(rows), [
        { channelIds: ['1', '2'], variantCount: 1, stockOnHand: 7, stockAllocated: 2 },
        { channelIds: ['2'], variantCount: 1, stockOnHand: 3, stockAllocated: 1 },
    ]);
    assert.throws(() => summarizeStockOwnership([...rows, { ...rows[0], stockOnHand: 8 }]), /Conflicting/u);
    assert.throws(() => summarizeStockOwnership([{ ...rows[0], stockOnHand: 'invalid' }]), /Unsafe/u);
});

test('MySQL audit setup and close always attempt rollback and close the owned connection', async () => {
    const successfulCalls = [];
    const connection = {
        query: async sql => successfulCalls.push(sql),
        end: async () => successfulCalls.push('END'),
    };
    const adapter = await createReadOnlyMysqlAdapter(connection);
    await adapter.close();
    assert.deepEqual(successfulCalls, [
        'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ',
        'SET SESSION TRANSACTION READ ONLY',
        'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
        'ROLLBACK',
        'END',
    ]);

    const failedCalls = [];
    const failingConnection = {
        query: async sql => {
            failedCalls.push(sql);
            if (sql.startsWith('START TRANSACTION')) throw new Error('fixture start failure');
        },
        end: async () => failedCalls.push('END'),
    };
    await assert.rejects(createReadOnlyMysqlAdapter(failingConnection), /fixture start failure/u);
    assert.deepEqual(failedCalls, [
        'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ',
        'SET SESSION TRANSACTION READ ONLY',
        'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
        'ROLLBACK',
        'END',
    ]);
});

test('digital preflight reports symlinks and rejects a linked root', async () => {
    const root = await fixtureDirectory();
    try {
        await writeFile(path.join(root, 'source.txt'), 'source');
        await symlink(path.join(root, 'source.txt'), path.join(root, 'link.txt'));
        const result = await scanDigitalDeliveryRoot(root);
        assert.deepEqual(result.unsafeLegacyFileNames, ['link.txt']);
        assert.equal(result.legacyFiles.length, 1);
        await symlink(root, path.join(root, 'linked-root'));
        await assert.rejects(scanDigitalDeliveryRoot(path.join(root, 'linked-root')), /Unsafe/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('read-only SQL collection joins stock ownership and automatically hashes and matches a real local delivery file', async () => {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    const root = await fixtureDirectory();
    try {
        database.run(`
            CREATE TABLE channel (id INTEGER, code TEXT);
            INSERT INTO channel VALUES (1, 'store-a'), (2, 'store-b');
            CREATE TABLE stock_location (id INTEGER, name TEXT);
            INSERT INTO stock_location VALUES (1, 'shared');
            CREATE TABLE stock_location_channels_channel (stockLocationId INTEGER, channelId INTEGER);
            INSERT INTO stock_location_channels_channel VALUES (1, 1), (1, 2);
            CREATE TABLE product_variant (id INTEGER, sku TEXT);
            INSERT INTO product_variant VALUES (1, 'SHARED'), (2, 'SKU');
            CREATE TABLE product_variant_channels_channel (productVariantId INTEGER, channelId INTEGER);
            INSERT INTO product_variant_channels_channel VALUES (1, 1), (1, 2), (2, 2);
            CREATE TABLE stock_level (stockLocationId INTEGER, productVariantId INTEGER, stockOnHand INTEGER, stockAllocated INTEGER);
            INSERT INTO stock_level VALUES (1, 1, 7, 2), (1, 2, 3, 1);
        `);
        const query = async (sql, parameters = []) => {
            assert.match(sql.trim(), /^(SELECT|PRAGMA)\b/u, 'Collector attempted a write');
            const statement = database.prepare(sql);
            try {
                statement.bind(parameters);
                const rows = [];
                while (statement.step()) rows.push(statement.getAsObject());
                return rows;
            } finally {
                statement.free();
            }
        };
        const adapter = {
            query,
            tableExists: async name =>
                (await query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length >
                0,
            columnExists: async (table, column) =>
                (await query(`PRAGMA table_info(${table})`)).some(row => row.name === column),
        };
        await writeFile(path.join(root, 'SKU.txt'), 'fixture delivery');
        const snapshot = await collectStoreIsolationSnapshot(adapter, root);
        const report = buildStoreIsolationPreflight(snapshot, 'fixture-key');
        const buckets = report.associations.stockLocations.shared[0].variantBuckets;
        assert.equal(
            buckets.reduce((sum, item) => sum + item.stockOnHand, 0),
            10,
        );
        assert.equal(
            buckets.reduce((sum, item) => sum + item.stockAllocated, 0),
            3,
        );
        assert.deepEqual(report.digitalDelivery.legacyFiles[0].candidateChannelIds, ['2']);
        assert.equal(
            report.digitalDelivery.legacyFiles[0].sha256,
            createHash('sha256').update('fixture delivery').digest('hex'),
        );
    } finally {
        database.close();
        await rm(root, { recursive: true, force: true });
    }
});
