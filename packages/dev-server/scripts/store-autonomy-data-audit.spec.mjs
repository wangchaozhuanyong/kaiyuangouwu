import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { RESET_TABLES } from './prelaunch-generated-data-reset.mjs';
import {
    collectStoreAutonomyAudit,
    GENERATED_RECORD_AUDIT_TABLES,
    sharedResourceIsolationChecks,
} from './store-autonomy-data-audit.mjs';

const { validateStoreAutonomyAuditPayload } = createRequire(import.meta.url)(
    '../../../deploy/production-operations.cjs',
);

test('shared store-owned resources are release blockers while shared customer identity remains allowed', () => {
    const empty = { available: true, shared: [] };
    const snapshot = {
        associations: {
            customers: { available: true, shared: [{ entityId: 1, channelIds: ['2', '3'] }] },
            stockLocations: empty,
            paymentMethods: empty,
            shippingMethods: empty,
            products: { available: true, shared: [{ entityId: 2, channelIds: ['2', '3'] }] },
            productVariants: empty,
            collections: empty,
            assets: { available: true, shared: [{ entityId: 3, channelIds: ['2', '3'] }] },
            assetTags: empty,
            facets: empty,
            facetValues: empty,
            productOptionGroups: empty,
            productOptions: empty,
            promotions: empty,
            sellers: empty,
        },
    };

    const checks = sharedResourceIsolationChecks(snapshot);
    assert.equal(
        checks.some(check => check.key === 'shared-customers'),
        false,
    );
    assert.deepEqual(
        checks.filter(check => check.status === 'FAIL').map(check => [check.key, check.count]),
        [
            ['shared-products', 1],
            ['shared-assets', 1],
        ],
    );
});

test('classifies default membership separately without waiving unresolved ownership blockers', () => {
    const snapshot = {
        channels: [
            { id: '1', code: '__default_channel__' },
            { id: '2', code: 'store-a' },
            { id: '3', code: 'store-b' },
        ],
        associations: {
            assets: {
                available: true,
                shared: [
                    { entityId: 1, channelIds: ['1', '2'] },
                    { entityId: 2, channelIds: ['1', '2', '3'] },
                    { entityId: 3, channelIds: ['2', 'missing-channel'] },
                ],
            },
        },
    };
    const check = sharedResourceIsolationChecks(snapshot).find(item => item.key === 'shared-assets');
    assert.equal(check.count, 3);
    assert.equal(check.status, 'FAIL');
    assert.deepEqual(check.classification, {
        defaultAndSingleStore: 1,
        multipleOperatingStores: 1,
        unknownChannels: 1,
    });
    delete snapshot.channels;
    assert.deepEqual(
        sharedResourceIsolationChecks(snapshot).find(item => item.key === 'shared-assets').classification,
        { defaultAndSingleStore: 0, multipleOperatingStores: 0, unknownChannels: 3 },
    );
});

async function createFixture({
    legacyStructure = false,
    violations = false,
    generatedRecords = false,
    zeroOrders = false,
} = {}) {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    const salesOwner = legacyStructure ? '' : ', salesChannelId INTEGER';
    database.run(`
        CREATE TABLE seller (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO seller VALUES (1, 'Platform'), (2, 'Store A'), (3, 'Store B');
        CREATE TABLE channel (id INTEGER PRIMARY KEY, code TEXT NOT NULL, sellerId INTEGER);
        INSERT INTO channel VALUES
            (1, '__default_channel__', 1), (2, 'store-a', 2), (3, 'store-b', 3);
        CREATE TABLE \`user\` (id INTEGER PRIMARY KEY, identifier TEXT, deletedAt DATETIME);
        CREATE TABLE customer (id INTEGER PRIMARY KEY, userId INTEGER);
        CREATE TABLE customer_channels_channel (customerId INTEGER, channelId INTEGER);
        CREATE TABLE stock_location (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE stock_location_channels_channel (stockLocationId INTEGER, channelId INTEGER);
        CREATE TABLE payment_method (id INTEGER PRIMARY KEY, code TEXT);
        CREATE TABLE payment_method_channels_channel (paymentMethodId INTEGER, channelId INTEGER);
        CREATE TABLE shipping_method (id INTEGER PRIMARY KEY, code TEXT);
        CREATE TABLE shipping_method_channels_channel (shippingMethodId INTEGER, channelId INTEGER);
        CREATE TABLE product (id INTEGER PRIMARY KEY);
        CREATE TABLE product_channels_channel (productId INTEGER, channelId INTEGER);
        CREATE TABLE product_variant (id INTEGER PRIMARY KEY, sku TEXT);
        CREATE TABLE product_variant_channels_channel (productVariantId INTEGER, channelId INTEGER);
        CREATE TABLE collection (id INTEGER PRIMARY KEY);
        CREATE TABLE collection_channels_channel (collectionId INTEGER, channelId INTEGER);
        CREATE TABLE asset (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE asset_channels_channel (assetId INTEGER, channelId INTEGER);
        CREATE TABLE tag (id INTEGER PRIMARY KEY, value TEXT);
        CREATE TABLE asset_tags_tag (assetId INTEGER, tagId INTEGER);
        CREATE TABLE facet (id INTEGER PRIMARY KEY, code TEXT);
        CREATE TABLE facet_channels_channel (facetId INTEGER, channelId INTEGER);
        CREATE TABLE facet_value (id INTEGER PRIMARY KEY, code TEXT);
        CREATE TABLE facet_value_channels_channel (facetValueId INTEGER, channelId INTEGER);
        CREATE TABLE product_option_group (id INTEGER PRIMARY KEY, code TEXT);
        CREATE TABLE product_option_group_channels_channel (productOptionGroupId INTEGER, channelId INTEGER);
        CREATE TABLE product_option (id INTEGER PRIMARY KEY, code TEXT);
        CREATE TABLE product_option_channels_channel (productOptionId INTEGER, channelId INTEGER);
        CREATE TABLE promotion (id INTEGER PRIMARY KEY, couponCode TEXT);
        CREATE TABLE promotion_channels_channel (promotionId INTEGER, channelId INTEGER);
        CREATE TABLE customer_group (id INTEGER PRIMARY KEY${legacyStructure ? '' : ', channelId INTEGER'});
        ${legacyStructure ? '' : 'CREATE TABLE customer_store_entry (id INTEGER PRIMARY KEY, customerId INTEGER, channelId INTEGER);'}
        CREATE TABLE \`order\` (id INTEGER PRIMARY KEY, customerId INTEGER, active INTEGER${salesOwner});
        CREATE TABLE order_channels_channel (orderId INTEGER, channelId INTEGER);
        CREATE TABLE storefront_cart (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE storefront_cart_checkout (id INTEGER PRIMARY KEY, cartId INTEGER, orderId INTEGER);
        CREATE TABLE referral_wallet (
            id INTEGER PRIMARY KEY, channelId INTEGER, customerId INTEGER, currencyCode TEXT,
            availableBalance INTEGER, pendingBalance INTEGER, reservedBalance INTEGER
        );
        CREATE TABLE referral_ledger_entry (
            id INTEGER PRIMARY KEY, walletId INTEGER, channelId INTEGER, customerId INTEGER,
            currencyCode TEXT, availableDelta INTEGER, pendingDelta INTEGER, reservedDelta INTEGER,
            availableAfter INTEGER, pendingAfter INTEGER, reservedAfter INTEGER
        );
        CREATE TABLE referral_wallet_usage (
            id INTEGER PRIMARY KEY, walletId INTEGER, channelId INTEGER, customerId INTEGER,
            currencyCode TEXT
        );
        CREATE TABLE customer_coupon (
            id INTEGER PRIMARY KEY, channelId INTEGER, lockedOrderId INTEGER, usedOrderId INTEGER
        );
        CREATE TABLE storefront_usdt_payment_intent (id INTEGER PRIMARY KEY, channelId INTEGER, orderId INTEGER);
        CREATE TABLE store_usdt_manual_refund (id INTEGER PRIMARY KEY, channelId INTEGER, orderId INTEGER);
        CREATE TABLE store_domain (id INTEGER PRIMARY KEY, channelId INTEGER, isPrimary INTEGER, status TEXT);
        CREATE TABLE store_profile (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE storefront_content_settings (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE catalog_import_job (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE catalog_import_row (
            id INTEGER PRIMARY KEY, expectedProductUpdatedAt DATETIME, expectedVariantUpdatedAt DATETIME
        );
        CREATE TABLE manual_digital_delivery (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE after_sales_request (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE storefront_review (id INTEGER PRIMARY KEY, channelId INTEGER);
        CREATE TABLE image_generation_job (id INTEGER PRIMARY KEY, channelId INTEGER);
        INSERT INTO store_domain VALUES
            (2, 2, 1, 'ACTIVE'), (3, 3, 1, 'ACTIVE');
        INSERT INTO store_profile VALUES (2, 2), (3, 3);
        INSERT INTO storefront_content_settings VALUES (2, 2), (3, 3);
        INSERT INTO \`user\` VALUES (1, 'member@example.test', NULL);
        INSERT INTO customer VALUES (1, 1);
        INSERT INTO customer_channels_channel VALUES (1, 2), (1, 3);
        INSERT INTO \`order\` VALUES (1, 1, 0${legacyStructure ? '' : ', 2'});
        INSERT INTO order_channels_channel VALUES (1, 2);
        INSERT INTO storefront_cart VALUES (1, 2);
        INSERT INTO storefront_cart_checkout VALUES (1, 1, 1);
        INSERT INTO referral_wallet VALUES (1, 2, 1, 'MYR', 0, 0, 0);
        INSERT INTO referral_ledger_entry VALUES (1, 1, 2, 1, 'MYR', 0, 0, 0, 0, 0, 0);
        INSERT INTO referral_wallet_usage VALUES (1, 1, 2, 1, 'MYR');
    `);
    if (violations) {
        database.run(`
            INSERT INTO \`user\` VALUES (2, 'MEMBER@example.test', NULL);
            INSERT INTO customer VALUES (2, 2);
            INSERT INTO customer_channels_channel VALUES (2, 3);
            INSERT INTO store_domain VALUES (4, 1, 1, 'ACTIVE');
            INSERT INTO \`order\` VALUES (2, 2, 1${legacyStructure ? '' : ', 2'});
            INSERT INTO order_channels_channel VALUES (2, 2), (2, 3);
            INSERT INTO \`order\` VALUES (3, 2, 0${legacyStructure ? '' : ', 2'});
            INSERT INTO order_channels_channel VALUES (3, 2);
            INSERT INTO storefront_cart VALUES (2, 3);
            INSERT INTO storefront_cart_checkout VALUES (2, 2, 3);
            INSERT INTO referral_ledger_entry VALUES (2, 1, 3, 2, 'CNY', 0, 0, 0, 1, 0, 0);
            INSERT INTO referral_wallet_usage VALUES (2, 1, 3, 2, 'CNY');
            INSERT INTO customer_coupon VALUES (1, 3, NULL, 3);
            INSERT INTO storefront_usdt_payment_intent VALUES (1, 3, 3);
            INSERT INTO store_usdt_manual_refund VALUES (1, 3, 3);
        `);
    }
    if (generatedRecords) {
        database.run(`
            CREATE TABLE shipping_line (id INTEGER PRIMARY KEY, privatePayload TEXT);
            INSERT INTO shipping_line VALUES (1, 'shipping-payload-must-not-leave-server');
            CREATE TABLE customer_product_activity (id INTEGER PRIMARY KEY, customerId INTEGER);
            INSERT INTO customer_product_activity VALUES (1, 999);
            CREATE TABLE storefront_page_view (id INTEGER PRIMARY KEY, channelId INTEGER);
            INSERT INTO storefront_page_view VALUES (1, NULL), (2, 999);
            INSERT INTO storefront_cart VALUES (99, NULL);
            CREATE TABLE job_record (id INTEGER PRIMARY KEY, state TEXT, isSettled INTEGER,
                settledAt TEXT, data TEXT, error TEXT);
            INSERT INTO job_record VALUES
                (1, 'COMPLETED', 1, '2026-10-01', 'private-job-payload', 'private-error'),
                (2, 'FAILED', 1, '2026-10-01', 'private-job-payload', 'private-error'),
                (3, 'CANCELLED', 1, '2026-10-01', 'private-job-payload', 'private-error'),
                (4, 'RUNNING', 0, NULL, 'private-job-payload', 'private-error'),
                (5, 'PENDING', 0, NULL, 'private-job-payload', 'private-error'),
                (6, 'RETRYING', 0, NULL, 'private-job-payload', 'private-error'),
                (7, 'FAILED', 1, NULL, 'private-job-payload', 'private-error'),
                (8, 'unknown-private-state', 1, '2026-10-01', 'private-job-payload', 'private-error'),
                (9, 'COMPLETED', 0, '2026-10-01', 'private-job-payload', 'private-error');
            ALTER TABLE catalog_import_job ADD COLUMN state TEXT;
            INSERT INTO catalog_import_job VALUES
                (1, 2, 'COMPLETED'), (2, 2, 'RUNNING'), (3, 2, 'unknown-import-state');
        `);
    }
    if (zeroOrders) database.run('DELETE FROM order_channels_channel; DELETE FROM `order`;');
    const query = async (sql, parameters = []) => {
        assert.match(sql.trim(), /^(SELECT|PRAGMA)\b/u, 'Audit attempted a database write');
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
    return {
        adapter: {
            kind: 'sqlite',
            query,
            tableExists: async name =>
                (await query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length >
                0,
            columnExists: async (tableName, columnName) =>
                (await query(`PRAGMA table_info(\`${tableName}\`)`)).some(row => row.name === columnName),
            columnMetadata: async (tableName, columnName) => {
                const column = (await query(`PRAGMA table_info(\`${tableName}\`)`)).find(
                    row => row.name === columnName,
                );
                return column
                    ? { dataType: String(column.type).toLowerCase(), datetimePrecision: null }
                    : null;
            },
        },
        close: () => database.close(),
    };
}

test('complete synthetic multi-store state passes without exposing customer, order, or file identifiers', async () => {
    const fixture = await createFixture();
    try {
        const report = await collectStoreAutonomyAudit(fixture.adapter, { auditKey: 'fixture-key' });
        assert.equal(report.verdict, 'GO');
        assert.equal(report.coverageComplete, true);
        assert.equal(report.channelCount, 3);
        assert.deepEqual(report.defaultChannelSeparation.orders, {
            available: true,
            total: 1,
            noMembership: 0,
            defaultOnly: 0,
            singleNonDefault: 1,
            multipleNonDefault: 0,
        });
        assert.equal(report.defaultChannelSeparation.mappingDeterministic, true);
        assert.equal(report.defaultChannelSeparation.readyForReviewedCutover, false);
        assert.equal(
            report.checks.every(check => check.status === 'PASS'),
            true,
        );
        assert.equal(
            report.structure.every(check => check.status === 'PASS'),
            true,
        );
        const serialized = JSON.stringify(report);
        for (const forbidden of ['member@example.test', 'customerId', 'orderId', 'fileName']) {
            assert.equal(serialized.includes(forbidden), false);
        }
    } finally {
        fixture.close();
    }
});

test('legacy ownership gaps and cross-store references fail closed with aggregate-only evidence', async () => {
    const fixture = await createFixture({ legacyStructure: true, violations: true });
    try {
        const report = await collectStoreAutonomyAudit(fixture.adapter, { auditKey: 'fixture-key' });
        assert.equal(report.verdict, 'NO_GO');
        assert.equal(report.structure.find(check => check.key === 'unique-order-sales-owner').status, 'FAIL');
        assert.equal(report.checks.find(check => check.key === 'duplicate-live-member-identities').count, 1);
        assert.equal(
            report.checks.find(check => check.key === 'cart-checkout-order-channel-mismatch').count,
            1,
        );
        assert.equal(report.checks.find(check => check.key === 'wallet-ledger-owner-mismatch').count, 1);
        assert.equal(report.checks.find(check => check.key === 'coupon-order-channel-mismatch').count, 1);
        assert.equal(
            report.checks.find(check => check.key === 'orders-with-multiple-nondefault-memberships').count,
            1,
        );
        assert.equal(report.defaultChannelSeparation.orders.multipleNonDefault, 1);
        assert.equal(report.defaultChannelSeparation.mappingDeterministic, false);
        assert.equal(JSON.stringify(report).includes('MEMBER@example.test'), false);
    } finally {
        fixture.close();
    }
});

test('strict production mode refuses legacy structure before aggregate business-data queries', async () => {
    const fixture = await createFixture({ legacyStructure: true, violations: true });
    let aggregateQueries = 0;
    const query = fixture.adapter.query;
    fixture.adapter.query = async (...args) => {
        if (/COUNT\(\*\)/u.test(args[0])) aggregateQueries++;
        return query(...args);
    };
    try {
        await assert.rejects(
            collectStoreAutonomyAudit(fixture.adapter, {
                auditKey: 'fixture-key',
                requireExpectedSchema: true,
            }),
            /Required store isolation database structure/u,
        );
        assert.equal(aggregateQueries, 0);
    } finally {
        fixture.close();
    }
});

test('fixed global count scope covers reset records and orphan order/activity tables without identity tables', () => {
    assert.equal(GENERATED_RECORD_AUDIT_TABLES.length, 51);
    assert.equal(new Set(GENERATED_RECORD_AUDIT_TABLES).size, 51);
    for (const table of RESET_TABLES) assert.ok(GENERATED_RECORD_AUDIT_TABLES.includes(table), table);
    for (const table of [
        'order',
        'order_line',
        'shipping_line',
        'surcharge',
        'payment',
        'refund',
        'order_modification',
        'fulfillment',
        'fulfillment_line',
        'customer_product_activity',
    ])
        assert.ok(GENERATED_RECORD_AUDIT_TABLES.includes(table), table);
    for (const table of [
        'user',
        'customer',
        'administrator',
        'authentication_method',
        'asset',
        'product',
        'stock_level',
        'catalog_source_binding',
        'catalog_import_job',
    ])
        assert.equal(GENERATED_RECORD_AUDIT_TABLES.includes(table), false, table);
});

test('global counts expose orphan generated rows even when there are no orders or channel memberships', async () => {
    const fixture = await createFixture({ generatedRecords: true, zeroOrders: true });
    try {
        const report = await collectStoreAutonomyAudit(fixture.adapter, { auditKey: 'fixture-key' });
        const counts = report.generatedRecordCounts;
        assert.equal(report.defaultChannelSeparation.orders.total, 0);
        assert.equal(counts.mode, 'global-counts-only-no-delete-permission');
        assert.equal(counts.tables.order, 0);
        assert.equal(counts.tables.shipping_line, 1);
        assert.equal(counts.tables.customer_product_activity, 1);
        assert.equal(counts.tables.storefront_page_view, 2);
        assert.equal(counts.tables.storefront_cart, 2);
        assert.equal(
            Object.values(report.perChannelCounts).reduce(
                (total, channel) => total + channel.storefront_page_view,
                0,
            ),
            0,
        );
        assert.equal(counts.tables.order_line, null);
        assert.equal(counts.status, 'DATA_MISSING');
        assert.equal(counts.catalogImports.policy, 'PRESERVE_PRODUCT_PROVENANCE');
        assert.equal(counts.catalogImports.total, 3);
        assert.equal(counts.catalogImports.byState.COMPLETED, 1);
        assert.equal(counts.catalogImports.byState.RUNNING, 1);
        assert.equal(counts.catalogImports.byState.OTHER, 1);
        const serialized = JSON.stringify(report);
        assert.ok(Buffer.byteLength(serialized) < 60000);
        assert.deepEqual(validateStoreAutonomyAuditPayload(serialized), report);
        for (const value of [
            'shipping-payload-must-not-leave-server',
            'private-job-payload',
            'private-error',
            'unknown-private-state',
            'unknown-import-state',
            'customerId',
            'orderId',
            'password',
            'credential',
        ])
            assert.equal(serialized.includes(value), false, value);
    } finally {
        fixture.close();
    }
});

test('job summary preserves active, unknown and incompletely settled work outside safe terminal counts', async () => {
    const fixture = await createFixture({ generatedRecords: true });
    try {
        const report = await collectStoreAutonomyAudit(fixture.adapter, { auditKey: 'fixture-key' });
        assert.deepEqual(report.generatedRecordCounts.jobs, {
            status: 'OK',
            total: 9,
            byState: {
                CREATED: 0,
                PENDING: 1,
                RUNNING: 1,
                COMPLETED: 2,
                RETRYING: 1,
                FAILED: 2,
                CANCELLED: 1,
                OTHER: 1,
            },
            safeTerminal: 3,
            nonTerminalOrUnsettled: 6,
            terminalStateUnsettled: 2,
        });
    } finally {
        fixture.close();
    }
});

test('missing generated tables or state columns report DATA_MISSING instead of invented zeroes', async () => {
    const fixture = await createFixture();
    try {
        const report = await collectStoreAutonomyAudit(fixture.adapter, { auditKey: 'fixture-key' });
        assert.equal(report.generatedRecordCounts.tables.job_record, null);
        assert.deepEqual(report.generatedRecordCounts.jobs, {
            status: 'DATA_MISSING',
            total: null,
            safeTerminal: null,
            nonTerminalOrUnsettled: null,
            terminalStateUnsettled: null,
            byState: null,
        });
        assert.deepEqual(report.generatedRecordCounts.catalogImports, {
            policy: 'PRESERVE_PRODUCT_PROVENANCE',
            status: 'DATA_MISSING',
            total: null,
            byState: null,
        });
        assert.equal(report.verdict, 'GO');
    } finally {
        fixture.close();
    }
});

test('missing or failed COUNT output fails closed rather than reporting a clean table', async () => {
    for (const [output, failure] of [
        [[{}], /Missing aggregate count/u],
        [[{ value: null }], /Missing aggregate count/u],
        [[{ value: '' }], /Unsafe aggregate count/u],
        [[{ value: true }], /Unsafe aggregate count/u],
        [[{ value: -1 }], /Unsafe aggregate count/u],
        [null, /Synthetic count failure/u],
    ]) {
        const fixture = await createFixture({ generatedRecords: true });
        const query = fixture.adapter.query;
        fixture.adapter.query = async (...args) => {
            if (args[0] === 'SELECT COUNT(*) AS value FROM `shipping_line`') {
                if (output === null) throw new Error('Synthetic count failure');
                return output;
            }
            return query(...args);
        };
        try {
            await assert.rejects(
                collectStoreAutonomyAudit(fixture.adapter, { auditKey: 'fixture-key' }),
                failure,
            );
        } finally {
            fixture.close();
        }
    }
});
