import assert from 'node:assert/strict';
import test from 'node:test';

import {
    collectProductOwnershipPreflight,
    summarizeProductOwnership,
} from './product-ownership-preflight.mjs';

function createReadOnlyAdapter(database) {
    const statements = [];
    const queries = [];
    const adapter = {
        tableExists: async table => {
            const statement = database.prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            );
            statement.bind([table]);
            const exists = statement.step();
            statement.free();
            return exists;
        },
        columnExists: async (table, column) => {
            const statement = database.prepare(`PRAGMA table_info(\`${table}\`)`);
            const columns = [];
            while (statement.step()) columns.push(statement.getAsObject().name);
            statement.free();
            return columns.includes(column);
        },
        query: async (sql, parameters = []) => {
            statements.push(sql);
            queries.push({ sql, parameters: [...parameters] });
            const statement = database.prepare(sql);
            try {
                statement.bind(parameters);
                const rows = [];
                while (statement.step()) rows.push(statement.getAsObject());
                return rows;
            } finally {
                statement.free();
            }
        },
    };
    return { adapter, statements, queries };
}

test('ownership summary blocks shared products and mismatched related entities', () => {
    const report = summarizeProductOwnership('1', {
        product: {
            id: '1',
            channels: [
                { id: '2', code: 'store-a' },
                { id: '3', code: 'store-b' },
            ],
        },
        related: {
            variants: [
                { id: '11', label: 'SKU-11', missingEntity: false, channels: [{ id: '3', code: 'store-b' }] },
            ],
        },
    });
    assert.equal(report.editableAsExclusiveStoreProduct, false);
    assert.deepEqual(
        report.blockers.map(item => item.code),
        ['PRODUCT_SHARED_ACROSS_STORES', 'RELATED_OWNERSHIP_CONFLICT'],
    );
});

test('collector traces product and scoped stock ownership without writes', async t => {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    try {
        database.run(`
            CREATE TABLE channel (id INTEGER, code TEXT);
            CREATE TABLE \`order\` (id INTEGER, salesChannelId INTEGER);
            CREATE TABLE order_line (id INTEGER, orderId INTEGER, productVariantId INTEGER);
            CREATE TABLE product (id INTEGER, featuredAssetId INTEGER, deletedAt TEXT);
            CREATE TABLE product_channels_channel (productId INTEGER, channelId INTEGER);
            CREATE TABLE product_variant (id INTEGER, productId INTEGER, sku TEXT, featuredAssetId INTEGER, deletedAt TEXT);
            CREATE TABLE product_variant_channels_channel (productVariantId INTEGER, channelId INTEGER);
            CREATE TABLE product_asset (productId INTEGER, assetId INTEGER);
            CREATE TABLE product_variant_asset (productVariantId INTEGER, assetId INTEGER);
            CREATE TABLE asset (id INTEGER);
            CREATE TABLE asset_channels_channel (assetId INTEGER, channelId INTEGER);
            CREATE TABLE collection (id INTEGER);
            CREATE TABLE collection_channels_channel (collectionId INTEGER, channelId INTEGER);
            CREATE TABLE collection_product_variants_product_variant (collectionId INTEGER, productVariantId INTEGER);
            CREATE TABLE facet (id INTEGER, code TEXT);
            CREATE TABLE facet_channels_channel (facetId INTEGER, channelId INTEGER);
            CREATE TABLE facet_value (id INTEGER, code TEXT, facetId INTEGER);
            CREATE TABLE facet_value_channels_channel (facetValueId INTEGER, channelId INTEGER);
            CREATE TABLE product_facet_values_facet_value (productId INTEGER, facetValueId INTEGER);
            CREATE TABLE product_variant_facet_values_facet_value (productVariantId INTEGER, facetValueId INTEGER);
            CREATE TABLE product_option_group (id INTEGER, code TEXT);
            CREATE TABLE product_option_group_channels_channel (productOptionGroupId INTEGER, channelId INTEGER);
            CREATE TABLE product_option_groups_product_option_group (productId INTEGER, productOptionGroupId INTEGER);
            CREATE TABLE product_option (id INTEGER, code TEXT, groupId INTEGER);
            CREATE TABLE product_option_channels_channel (productOptionId INTEGER, channelId INTEGER);
            CREATE TABLE product_variant_options_product_option (productVariantId INTEGER, productOptionId INTEGER);
            CREATE TABLE stock_level (id INTEGER, productVariantId INTEGER, stockLocationId INTEGER, stockOnHand INTEGER, stockAllocated INTEGER);
            CREATE TABLE stock_location (id INTEGER, name TEXT);
            CREATE TABLE stock_location_channels_channel (stockLocationId INTEGER, channelId INTEGER);
            INSERT INTO channel VALUES (1, '__default_channel__'), (2, 'moyao-ai'), (3, 'other-store'), (4, NULL);
            INSERT INTO product VALUES (1, 20, NULL);
            INSERT INTO product_channels_channel VALUES (1, 2);
            INSERT INTO product_variant VALUES (11, 1, 'SKU-11', NULL, NULL);
            INSERT INTO product_variant VALUES (12, 1, 'OLD-SKU', NULL, '2026-01-01');
            INSERT INTO product VALUES (2, NULL, NULL);
            INSERT INTO product_variant VALUES (21, 2, 'OTHER-SKU', NULL, NULL);
            INSERT INTO product_variant_channels_channel VALUES (11, 2);
            INSERT INTO \`order\` VALUES (100, 1), (101, 2), (102, 1), (103, NULL);
            INSERT INTO order_line VALUES (1, 100, 11), (2, 101, 11), (3, 101, 11),
                (4, 102, 12), (5, 103, 11);
            INSERT INTO product_asset VALUES (1, 20);
            INSERT INTO asset VALUES (20);
            INSERT INTO asset_channels_channel VALUES (20, 2);
            INSERT INTO collection VALUES (50);
            INSERT INTO collection_channels_channel VALUES (50, 2);
            INSERT INTO collection_product_variants_product_variant VALUES (50, 11);
            INSERT INTO facet VALUES (40, 'brand');
            INSERT INTO facet_channels_channel VALUES (40, 2);
            INSERT INTO facet_value VALUES (41, 'moyao', 40);
            INSERT INTO facet_value_channels_channel VALUES (41, 2);
            INSERT INTO product_facet_values_facet_value VALUES (1, 41);
            INSERT INTO product_option_group VALUES (30, 'size');
            INSERT INTO product_option_group_channels_channel VALUES (30, 2);
            INSERT INTO product_option_groups_product_option_group VALUES (1, 30);
            INSERT INTO product_option VALUES (31, 'small', 30);
            INSERT INTO product_option_channels_channel VALUES (31, 2);
            INSERT INTO product_variant_options_product_option VALUES (11, 31);
            INSERT INTO stock_location VALUES (200, 'Unowned warehouse'), (201, 'Default warehouse'),
                (202, 'Shared warehouse'), (203, 'Other product warehouse'), (204, 'Unnamed Channel warehouse');
            INSERT INTO stock_location_channels_channel VALUES (201, 1), (202, 3), (202, 1), (202, 2), (203, 3), (204, 4);
            INSERT INTO stock_level VALUES (1000, 11, 200, 100, 0), (1001, 11, 201, -5, -2),
                (1002, 11, 202, 7, 3), (1003, 11, 999, 4, 1),
                (1004, 12, 203, 200, 0), (1005, 21, 203, 300, 0), (1006, 11, 204, 0, 0);
        `);
        const initialDatabaseBytes = database.export();
        const { adapter, statements, queries } = createReadOnlyAdapter(database);
        const report = await collectProductOwnershipPreflight(adapter, '1');
        assert.equal(report.editableAsExclusiveStoreProduct, true);
        assert.deepEqual(
            report.related.variants.map(item => item.label),
            ['SKU-11'],
        );
        assert.deepEqual(
            report.related.collections.map(item => item.id),
            ['50'],
        );
        assert.deepEqual(
            report.related.facets.map(item => item.id),
            ['40'],
        );
        assert.deepEqual(
            report.related.options.map(item => item.id),
            ['31'],
        );
        assert.deepEqual(report.historicalSales, {
            orderCount: 4,
            orderLineCount: 5,
            bySalesChannel: [
                { channelId: null, channelCode: null, orderCount: 1, orderLineCount: 1 },
                { channelId: '1', channelCode: '__default_channel__', orderCount: 2, orderLineCount: 2 },
                { channelId: '2', channelCode: 'moyao-ai', orderCount: 1, orderLineCount: 2 },
            ],
        });
        assert.deepEqual(report.stockOwnership, {
            variantIds: ['11'],
            levels: [
                {
                    id: '1000',
                    productVariantId: '11',
                    stockLocationId: '200',
                    stockOnHand: 100,
                    stockAllocated: 0,
                    stockLocationExists: true,
                    channels: [],
                },
                {
                    id: '1001',
                    productVariantId: '11',
                    stockLocationId: '201',
                    stockOnHand: -5,
                    stockAllocated: -2,
                    stockLocationExists: true,
                    channels: [{ id: '1', code: '__default_channel__' }],
                },
                {
                    id: '1002',
                    productVariantId: '11',
                    stockLocationId: '202',
                    stockOnHand: 7,
                    stockAllocated: 3,
                    stockLocationExists: true,
                    channels: [
                        { id: '1', code: '__default_channel__' },
                        { id: '2', code: 'moyao-ai' },
                        { id: '3', code: 'other-store' },
                    ],
                },
                {
                    id: '1003',
                    productVariantId: '11',
                    stockLocationId: '999',
                    stockOnHand: 4,
                    stockAllocated: 1,
                    stockLocationExists: false,
                    channels: [],
                },
                {
                    id: '1006',
                    productVariantId: '11',
                    stockLocationId: '204',
                    stockOnHand: 0,
                    stockAllocated: 0,
                    stockLocationExists: true,
                    channels: [{ id: '4', code: null }],
                },
            ],
        });
        const stockQuery = queries.find(({ sql }) => /FROM `stock_level`/u.test(sql));
        assert.match(stockQuery.sql, /WHERE stock.productVariantId IN \(\?\)/u);
        assert.deepEqual(stockQuery.parameters, ['11']);
        assert.match(
            stockQuery.sql,
            /LEFT JOIN `stock_location` location ON location.id = stock.stockLocationId/u,
        );
        assert.match(
            stockQuery.sql,
            /LEFT JOIN `stock_location_channels_channel` membership ON membership.stockLocationId = stock.stockLocationId/u,
        );
        assert.equal(queries.filter(({ sql }) => /FROM `stock_/u.test(sql)).length, 1);
        assert.doesNotMatch(JSON.stringify(report.stockOwnership), /SKU|warehouse|name|label/iu);
        assert.deepEqual(database.export(), initialDatabaseBytes);
        assert.ok(statements.every(sql => /^SELECT\b/u.test(sql.trim())));

        const stockColumns = {
            stock_level: ['id', 'productVariantId', 'stockLocationId', 'stockOnHand', 'stockAllocated'],
            stock_location: ['id'],
            stock_location_channels_channel: ['stockLocationId', 'channelId'],
            channel: ['id', 'code'],
        };
        const failures = [
            ...['stock_level', 'stock_location', 'stock_location_channels_channel'].map(table => ({
                name: `refuses missing ${table} table`,
                setup: `DROP TABLE \`${table}\``,
                error: /Missing required table/u,
            })),
            ...Object.entries(stockColumns).flatMap(([table, columns]) =>
                columns.map(column => ({
                    name: `refuses missing ${table}.${column} column`,
                    setup: `ALTER TABLE \`${table}\` RENAME COLUMN \`${column}\` TO missing_column`,
                    error: /Missing required column|no such column/u,
                })),
            ),
            {
                name: 'refuses duplicate active Variant IDs',
                setup: "INSERT INTO product_variant VALUES (11, 1, 'DUPLICATE', NULL, NULL)",
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses duplicate stock Level IDs',
                setup: 'INSERT INTO stock_level VALUES (1000, 11, 201, 10, 0)',
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses identical duplicate stock Level rows without Channels',
                setup: 'INSERT INTO stock_level SELECT * FROM stock_level WHERE id = 1000',
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses duplicate warehouse IDs',
                setup: "INSERT INTO stock_location VALUES (200, 'DUPLICATE')",
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses duplicate warehouse Channel relations',
                setup: 'INSERT INTO stock_location_channels_channel VALUES (201, 1)',
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses duplicate Channel IDs',
                setup: "INSERT INTO channel VALUES (2, 'DUPLICATE')",
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses unknown warehouse Channel IDs',
                setup: 'INSERT INTO stock_location_channels_channel VALUES (200, 99)',
                error: /Invalid stock ownership facts/u,
            },
            ...['id', 'productVariantId', 'stockLocationId'].map(column => ({
                name: `refuses invalid stock ${column}`,
                transform: (sql, rows) =>
                    /FROM `stock_level`/u.test(sql)
                        ? rows.map((row, index) => (index === 0 ? { ...row, [column]: 0 } : row))
                        : rows,
                error: /Invalid stock ownership facts/u,
            })),
            {
                name: 'refuses unsafe numeric IDs',
                setup: 'UPDATE stock_level SET id = 9007199254740992 WHERE id = 1000',
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses an out-of-scope stock Variant returned by the adapter',
                transform: (sql, rows) =>
                    /FROM `stock_level`/u.test(sql)
                        ? [
                              ...rows,
                              {
                                  id: 7000,
                                  productVariantId: 21,
                                  stockLocationId: 203,
                                  stockOnHand: 300,
                                  stockAllocated: 0,
                                  locationId: 203,
                                  memberLocationId: 203,
                                  channelId: 3,
                              },
                          ]
                        : rows,
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses an out-of-scope warehouse returned by the adapter',
                transform: (sql, rows) =>
                    /FROM `stock_level`/u.test(sql)
                        ? rows.map((row, index) => (index === 0 ? { ...row, locationId: 203 } : row))
                        : rows,
                error: /Invalid stock ownership facts/u,
            },
            {
                name: 'refuses an out-of-scope warehouse relation returned by the adapter',
                transform: (sql, rows) =>
                    /FROM `stock_level`/u.test(sql)
                        ? rows.map((row, index) =>
                              index === 0 ? { ...row, memberLocationId: 203, channelId: 3 } : row,
                          )
                        : rows,
                error: /Invalid stock ownership facts/u,
            },
            ...['stockOnHand', 'stockAllocated'].flatMap(column =>
                [null, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, '5', 'invalid'].map(
                    (value, index) => ({
                        name: `refuses unsafe ${column} case ${index}`,
                        transform: (sql, rows) =>
                            /FROM `stock_level`/u.test(sql)
                                ? rows.map((row, rowIndex) =>
                                      rowIndex === 0 ? { ...row, [column]: value } : row,
                                  )
                                : rows,
                        error: /Invalid stock ownership facts/u,
                    }),
                ),
            ),
        ];
        for (const failure of failures) {
            await t.test(failure.name, async () => {
                const fixture = new SQL.Database(initialDatabaseBytes);
                try {
                    if (failure.setup) fixture.run(failure.setup);
                    const before = fixture.export();
                    const { adapter: fixtureAdapter, statements: fixtureStatements } =
                        createReadOnlyAdapter(fixture);
                    const scopedAdapter = failure.transform
                        ? {
                              ...fixtureAdapter,
                              query: async (sql, parameters) =>
                                  failure.transform(sql, await fixtureAdapter.query(sql, parameters)),
                          }
                        : fixtureAdapter;
                    await assert.rejects(collectProductOwnershipPreflight(scopedAdapter, '1'), failure.error);
                    assert.ok(fixtureStatements.every(sql => /^SELECT\b/u.test(sql.trim())));
                    assert.deepEqual(fixture.export(), before);
                } finally {
                    fixture.close();
                }
            });
        }
        await t.test(
            'empty active Variant scope returns no stock and never queries inventory rows',
            async () => {
                const fixture = new SQL.Database(initialDatabaseBytes);
                try {
                    fixture.run("UPDATE product_variant SET deletedAt = '2026-01-01' WHERE id = 11");
                    const before = fixture.export();
                    const { adapter: fixtureAdapter, statements: fixtureStatements } =
                        createReadOnlyAdapter(fixture);
                    const result = await collectProductOwnershipPreflight(fixtureAdapter, '1');
                    assert.deepEqual(result.stockOwnership, { variantIds: [], levels: [] });
                    assert.ok(fixtureStatements.every(sql => /^SELECT\b/u.test(sql.trim())));
                    assert.ok(fixtureStatements.every(sql => !/FROM `stock_/u.test(sql)));
                    assert.deepEqual(fixture.export(), before);
                } finally {
                    fixture.close();
                }
            },
        );
        await t.test(
            'all current active Variants and safe signed integer quantities are preserved',
            async () => {
                const fixture = new SQL.Database(initialDatabaseBytes);
                try {
                    fixture.run("INSERT INTO product_variant VALUES (13, 1, 'SECOND-SKU', NULL, NULL)");
                    fixture.run('INSERT INTO product_variant_channels_channel VALUES (13, 2)');
                    fixture.run(
                        'INSERT INTO stock_level VALUES (1007, 13, 200, 9007199254740991, -9007199254740991)',
                    );
                    const before = fixture.export();
                    const {
                        adapter: fixtureAdapter,
                        queries: fixtureQueries,
                        statements: fixtureStatements,
                    } = createReadOnlyAdapter(fixture);
                    const result = await collectProductOwnershipPreflight(fixtureAdapter, '1');
                    assert.deepEqual(result.stockOwnership.variantIds, ['11', '13']);
                    assert.deepEqual(result.stockOwnership.levels.at(-1), {
                        id: '1007',
                        productVariantId: '13',
                        stockLocationId: '200',
                        stockOnHand: Number.MAX_SAFE_INTEGER,
                        stockAllocated: -Number.MAX_SAFE_INTEGER,
                        stockLocationExists: true,
                        channels: [],
                    });
                    assert.deepEqual(
                        fixtureQueries.find(({ sql }) => /FROM `stock_level`/u.test(sql)).parameters,
                        ['11', '13'],
                    );
                    assert.ok(fixtureStatements.every(sql => /^SELECT\b/u.test(sql.trim())));
                    assert.deepEqual(fixture.export(), before);
                    assert.deepEqual(result.blockers, report.blockers);
                } finally {
                    fixture.close();
                }
            },
        );

        database.run('INSERT INTO product_channels_channel VALUES (1, 1)');
        const legacyDefault = await collectProductOwnershipPreflight(adapter, '1');
        assert.equal(legacyDefault.editableAsExclusiveStoreProduct, false);
        assert.ok(legacyDefault.blockers.some(item => item.code === 'PRODUCT_REQUIRES_CHANNEL_MIGRATION'));

        database.run('INSERT INTO asset_channels_channel VALUES (20, 3)');
        const sharedAsset = await collectProductOwnershipPreflight(adapter, '1');
        assert.equal(sharedAsset.editableAsExclusiveStoreProduct, false);
        assert.ok(sharedAsset.blockers.some(item => item.type === 'assets' && item.entityId === '20'));

        database.run('UPDATE `order` SET salesChannelId = 99 WHERE id = 100');
        await assert.rejects(
            collectProductOwnershipPreflight(adapter, '1'),
            /Historical sale has an unknown sales Channel/u,
        );
    } finally {
        database.close();
    }
});

test('collector refuses invalid IDs and missing relation tables before any ownership claim', async () => {
    await assert.rejects(collectProductOwnershipPreflight({}, '1 OR 1=1'), /positive integer/u);
    await assert.rejects(
        collectProductOwnershipPreflight({ tableExists: async () => false }, '1'),
        /Missing required table/u,
    );
});
