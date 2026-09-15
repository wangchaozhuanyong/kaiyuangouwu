import assert from 'node:assert/strict';
import test from 'node:test';

import { collectStoreAutonomyAudit } from './store-autonomy-data-audit.mjs';

async function createFixture({ legacyStructure = false, violations = false } = {}) {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    const salesOwner = legacyStructure ? '' : ', salesChannelId INTEGER';
    database.run(`
        CREATE TABLE channel (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
        INSERT INTO channel VALUES (1, '__default_channel__'), (2, 'store-a'), (3, 'store-b');
        CREATE TABLE \`user\` (id INTEGER PRIMARY KEY, identifier TEXT, deletedAt DATETIME);
        CREATE TABLE customer (id INTEGER PRIMARY KEY, userId INTEGER);
        CREATE TABLE customer_channels_channel (customerId INTEGER, channelId INTEGER);
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
