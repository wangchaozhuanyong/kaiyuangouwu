import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectCustomerRelationSchema } from './store-isolation-customer-dependencies.mjs';
import {
    buildStoreIsolationPreflight,
    collectStoreIsolationSnapshot,
} from './store-isolation-data-preflight.mjs';
import { buildMigrationPlan } from './store-isolation-migration-plan.mjs';
import { redactOwnershipEvidence } from './store-isolation-ownership-evidence.mjs';

async function collectFixture(includeForeignWalletReference = false, extraSql = '') {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    const parent = fileURLToPath(
        new URL('../../../reports/pending-migrations-20260913/fixtures/', import.meta.url),
    );
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'ownership-'));
    try {
        const address = JSON.stringify({
            fullName: 'PRIVATE_PERSON_CANARY',
            streetLine1: 'PRIVATE_ADDRESS_CANARY',
            postalCode: '00100',
            phoneNumber: 'PRIVATE_PHONE_CANARY',
            countryCode: 'MY',
        });
        database.run(`
            CREATE TABLE channel (id INTEGER, code TEXT);
            INSERT INTO channel VALUES (1, 'store-a'), (2, 'store-b');
            CREATE TABLE customer (id INTEGER, userId INTEGER);
            INSERT INTO customer VALUES (11, 91);
            CREATE TABLE customer_channels_channel (customerId INTEGER, channelId INTEGER);
            INSERT INTO customer_channels_channel VALUES (11, 1), (11, 2);
            CREATE TABLE address (id INTEGER, customerId INTEGER, fullName TEXT, company TEXT, streetLine1 TEXT,
                streetLine2 TEXT, city TEXT, province TEXT, postalCode TEXT, phoneNumber TEXT, countryId INTEGER,
                defaultShippingAddress INTEGER, defaultBillingAddress INTEGER);
            INSERT INTO address VALUES (201, 11, 'PRIVATE_PERSON_CANARY', '', 'PRIVATE_ADDRESS_CANARY',
                '', '', '', '00100', 'PRIVATE_PHONE_CANARY', 221, 1, 0);
            CREATE TABLE region (id INTEGER, code TEXT, type TEXT);
            INSERT INTO region VALUES (221, 'MY', 'country');
            CREATE TABLE \`order\` (id INTEGER, customerId INTEGER, shippingAddress TEXT, billingAddress TEXT);
            INSERT INTO \`order\` VALUES (101, 11, '${address}', '{}'), (102, 11, '{}', '{}');
            CREATE TABLE order_channels_channel (orderId INTEGER, channelId INTEGER);
            INSERT INTO order_channels_channel VALUES (101, 1), (102, 2);
            CREATE TABLE order_line (id INTEGER, orderId INTEGER, productVariantId INTEGER);
            INSERT INTO order_line VALUES (111, 102, 51);
            CREATE TABLE product_variant (id INTEGER, sku TEXT, productId INTEGER);
            INSERT INTO product_variant VALUES (51, 'SKU', 501);
            CREATE TABLE product_variant_channels_channel (productVariantId INTEGER, channelId INTEGER);
            INSERT INTO product_variant_channels_channel VALUES (51, 2);
            CREATE TABLE stock_location (id INTEGER, name TEXT);
            INSERT INTO stock_location VALUES (41, 'warehouse');
            CREATE TABLE stock_location_channels_channel (stockLocationId INTEGER, channelId INTEGER);
            INSERT INTO stock_location_channels_channel VALUES (41, 1), (41, 2);
            CREATE TABLE stock_level (id INTEGER, stockLocationId INTEGER, productVariantId INTEGER, stockOnHand INTEGER, stockAllocated INTEGER);
            INSERT INTO stock_level VALUES (401, 41, 51, 7, 2);
            CREATE TABLE stock_movement (id INTEGER, stockLocationId INTEGER, productVariantId INTEGER, orderLineId INTEGER, type TEXT, quantity INTEGER);
            INSERT INTO stock_movement VALUES (411, 41, 51, 111, 'SALE', -1), (412, 41, 51, NULL, 'ADJUSTMENT', 8);
            CREATE TABLE referral_account (id INTEGER, customerId INTEGER, channelId INTEGER, inviteCode TEXT);
            INSERT INTO referral_account VALUES (301, 11, 2, 'PRIVATE_INVITE_CANARY');
            CREATE TABLE referral_wallet (id INTEGER, customerId INTEGER, channelId INTEGER, referralAccountId INTEGER,
                currencyCode TEXT, availableBalance INTEGER, pendingBalance INTEGER, reservedBalance INTEGER);
            INSERT INTO referral_wallet VALUES (311, 11, 2, 301, 'MYR', 5, 0, 0);
            CREATE TABLE referral_ledger_entry (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER,
                currencyCode TEXT, orderId INTEGER, refundId INTEGER, withdrawalId INTEGER, availableDelta INTEGER,
                pendingDelta INTEGER, reservedDelta INTEGER, availableAfter INTEGER, pendingAfter INTEGER, reservedAfter INTEGER);
            INSERT INTO referral_ledger_entry VALUES (321, 11, 2, 311, 'MYR', 102, NULL, NULL, 5, 0, 0, 5, 0, 0);
            CREATE TABLE referral_relationship (id INTEGER, inviterCustomerId INTEGER, inviteeCustomerId INTEGER, channelId INTEGER);
            INSERT INTO referral_relationship VALUES (331, 12, 11, 2);
            CREATE TABLE referral_reward (id INTEGER, inviterCustomerId INTEGER, inviteeCustomerId INTEGER, channelId INTEGER,
                orderId INTEGER, currencyCode TEXT, rewardAmount INTEGER, releasedAmount INTEGER, clawedBackAmount INTEGER, status TEXT);
            CREATE TABLE referral_balance_use (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER,
                orderId INTEGER, currencyCode TEXT, amount INTEGER, refundedAmount INTEGER, status TEXT);
            CREATE TABLE referral_wallet_usage (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER,
                currencyCode TEXT, amount INTEGER, capturedAmount INTEGER, releasedAmount INTEGER, status TEXT);
            CREATE TABLE referral_withdrawal (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER, currencyCode TEXT, amount INTEGER, status TEXT);
            CREATE TABLE payment_method (id INTEGER, code TEXT, enabled INTEGER, checker TEXT, handler TEXT);
            INSERT INTO payment_method VALUES (61, 'offline', 1, NULL, '{"code":"offline","args":[{"name":"apiKey","value":"PRIVATE_PROCESSOR_CANARY"}]}');
            CREATE TABLE payment_method_channels_channel (paymentMethodId INTEGER, channelId INTEGER);
            INSERT INTO payment_method_channels_channel VALUES (61, 1), (61, 2);
            CREATE TABLE payment (id INTEGER, method TEXT, orderId INTEGER);
            INSERT INTO payment VALUES (621, 'offline', 102);
            CREATE TABLE shipping_method (id INTEGER, code TEXT, checker TEXT, calculator TEXT, fulfillmentHandlerCode TEXT);
            INSERT INTO shipping_method VALUES (62, 'delivery', '{"code":"all","args":[]}', '{"code":"free","args":[]}', 'manual');
            CREATE TABLE shipping_method_channels_channel (shippingMethodId INTEGER, channelId INTEGER);
            INSERT INTO shipping_method_channels_channel VALUES (62, 1), (62, 2);
            CREATE TABLE shipping_line (id INTEGER, shippingMethodId INTEGER, orderId INTEGER);
            INSERT INTO shipping_line VALUES (631, 62, 102);
            CREATE TABLE customer_delivery_email (id INTEGER, customerId INTEGER, channelId INTEGER, isDefault INTEGER, emailAddress TEXT);
            INSERT INTO customer_delivery_email VALUES (701, 11, 1, 1, 'PRIVATE_EMAIL_CANARY');
            CREATE TABLE after_sales_request (id INTEGER, customerId INTEGER, channelId INTEGER, orderId INTEGER, refundId INTEGER);
            INSERT INTO after_sales_request VALUES (702, 11, 1, 101, NULL);
            CREATE TABLE customer_coupon (id INTEGER, customerId INTEGER, channelId INTEGER, promotionId INTEGER,
                campaignConfigId INTEGER, lockedOrderId INTEGER, usedOrderId INTEGER, status TEXT);
            INSERT INTO customer_coupon VALUES (711, 11, 1, 1, 1, 101, NULL, 'LOCKED');
            CREATE TABLE coupon_ledger_entry (id INTEGER, customerId INTEGER, channelId INTEGER, customerCouponId INTEGER,
                promotionId INTEGER, orderId INTEGER, refundId INTEGER, eventType TEXT);
            INSERT INTO coupon_ledger_entry VALUES (712, 11, 1, 711, 1, 101, NULL, 'LOCK');
            CREATE TABLE coupon_order_allocation (id INTEGER, customerId INTEGER, channelId INTEGER, customerCouponId INTEGER,
                promotionId INTEGER, orderId INTEGER, refundId INTEGER, status TEXT);
            INSERT INTO coupon_order_allocation VALUES (713, 11, 1, 711, 1, 101, NULL, 'LOCKED');
            CREATE TABLE storefront_daily_visitor (id INTEGER, customerId INTEGER, channelId INTEGER, visitCount INTEGER, visitorKeyHash TEXT);
            INSERT INTO storefront_daily_visitor VALUES (721, 11, 1, 3, 'PRIVATE_VISITOR_CANARY');
            CREATE TABLE customer_groups_customer_group (customerId INTEGER, customerGroupId INTEGER);
            INSERT INTO customer_groups_customer_group VALUES (11, 801);
            CREATE TABLE customer_group (id INTEGER);
            INSERT INTO customer_group VALUES (801);
            CREATE TABLE history_entry (id INTEGER, customerId INTEGER, orderId INTEGER, administratorId INTEGER, type TEXT, isPublic INTEGER, data TEXT);
            INSERT INTO history_entry VALUES (731, 11, 101, NULL, 'CUSTOMER_REGISTERED', 0, 'PRIVATE_HISTORY_CANARY');
            CREATE TABLE user (id INTEGER, verified INTEGER, deletedAt TEXT, identifier TEXT);
            INSERT INTO user VALUES (91, 1, NULL, 'PRIVATE_LOGIN_CANARY');
            CREATE TABLE authentication_method (id INTEGER, userId INTEGER, type TEXT, passwordHash TEXT, verificationToken TEXT);
            INSERT INTO authentication_method VALUES (741, 91, 'NativeAuthenticationMethod', 'PRIVATE_PASSWORD_CANARY', 'PRIVATE_TOKEN_CANARY');
            CREATE TABLE administrator (id INTEGER, userId INTEGER, deletedAt TEXT);
            CREATE TABLE session (id INTEGER, userId INTEGER, activeOrderId INTEGER, activeChannelId INTEGER,
                invalidated INTEGER, expires TEXT, authenticationStrategy TEXT, token TEXT);
            INSERT INTO session VALUES (751, 91, 101, 1, 0, '2026-09-14', 'native', 'PRIVATE_SESSION_CANARY');
            CREATE TABLE api_key (id INTEGER, userId INTEGER, ownerId INTEGER, deletedAt TEXT, apiKeyHash TEXT);
            CREATE TABLE api_key_channels_channel (apiKeyId INTEGER, channelId INTEGER);
            CREATE TABLE user_roles_role (userId INTEGER, roleId INTEGER);
            INSERT INTO user_roles_role VALUES (91, 761);
            CREATE TABLE role (id INTEGER, code TEXT, permissions TEXT);
            INSERT INTO role VALUES (761, 'customer', 'Authenticated,Owner');
            CREATE TABLE role_channels_channel (roleId INTEGER, channelId INTEGER);
            INSERT INTO role_channels_channel VALUES (761, 1), (761, 2);
        `);
        if (includeForeignWalletReference) {
            database.run(`INSERT INTO referral_withdrawal VALUES (341, 12, 2, 311, 'MYR', 1, 'PENDING')`);
        }
        if (extraSql) database.run(extraSql);
        const query = async (sql, parameters = []) => {
            assert.match(sql.trim(), /^(SELECT|PRAGMA)\b/u, 'Collector attempted a database write');
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
            kind: 'sqlite',
            query,
            tableExists: async name =>
                (await query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length >
                0,
            columnExists: async (table, column) =>
                (await query(`PRAGMA table_info(\`${table}\`)`)).some(row => row.name === column),
        };
        await writeFile(path.join(root, 'SKU.txt'), 'fixture delivery');
        const before = database.export();
        const snapshot = await collectStoreIsolationSnapshot(adapter, root);
        assert.doesNotMatch(JSON.stringify(snapshot.ownershipEvidence.customers.dependencies), /PRIVATE_/u);
        const report = buildStoreIsolationPreflight(snapshot, 'local-fixture-audit-key');
        assert.deepEqual(database.export(), before, 'Database changed during collection');
        return report;
    } finally {
        database.close();
        await rm(root, { recursive: true, force: true });
    }
}

const fixture = collectFixture();

test('real SQL produces linked, redacted ownership evidence without changing database or exposing private fields', async () => {
    const report = await fixture;
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|"(?:userId|customerId|walletId|handler)"\s*:/u);
    const evidence = report.ownershipEvidence;
    const customer = report.associations.customers.shared[0];
    assert.equal(evidence.customers.login.rows[0].entityRef, customer.entityRef);
    assert.equal(evidence.customers.addresses.rows[0].customerRef, customer.entityRef);
    assert.equal(
        evidence.customers.relations.referral_relationship.rows[0].inviteeCustomerRef,
        customer.entityRef,
    );
    const plan = buildMigrationPlan(report);
    assert.ok(plan.customers[0].missingFacts.includes('one-to-one-login-split-strategy'));
    assert.ok(plan.customers[0].missingFacts.includes('address-ownership'));
    assert.ok(plan.customers[0].missingFacts.includes('soft-reference-source-review-required'));
    assert.equal(
        plan.customers[0].missingFacts.some(fact => fact.startsWith('missing-dependency:')),
        false,
    );
    assert.equal(plan.customers[0].orderReferences.length, 2);
    assert.equal(plan.stockLocations[0].stockLevelReferences.length, 1);
    assert.equal(plan.stockLocations[0].movementReferences.length, 2);
    assert.deepEqual(plan.stockLocations[0].missingFacts, []);
    for (const config of plan.configuration) {
        assert.match(config.configurationFingerprint, /^[a-f0-9]{64}$/u);
        assert.equal(config.historicalReferences.length, 1);
        assert.deepEqual(config.historicalReferences[0].channelIds, ['2']);
        assert.deepEqual(config.missingFacts, []);
    }
    assert.equal(
        plan.digitalFiles[0].orderLineReferences[0].orderRef,
        plan.configuration[0].historicalReferences[0].orderRef,
    );
    assert.deepEqual(plan.digitalFiles[0].missingFacts, []);
    assert.equal(plan.readyForExecution, false);
});

test('planner blocks inconsistent wallet balances, cross-store wallet links, and missing relation schemas', async () => {
    const report = structuredClone(await fixture);
    const relations = report.ownershipEvidence.customers.relations;
    relations.referral_wallet.rows[0].availableBalance = 10;
    assert.ok(buildMigrationPlan(report).customers[0].missingFacts.includes('wallet-ledger-reconciliation'));
    relations.referral_ledger_entry.rows[0].channelId = '1';
    assert.ok(buildMigrationPlan(report).customers[0].missingFacts.includes('wallet-reference-mismatch'));
    relations.referral_relationship.available = false;
    assert.ok(buildMigrationPlan(report).customers[0].missingFacts.includes('referral-links'));
});

test('planner refuses incomplete order and stock maps and retains historical digital ownership conflicts', async () => {
    const report = structuredClone(await fixture);
    const incomplete = structuredClone(report);
    incomplete.ownershipEvidence.customers.orders.rows.pop();
    assert.throws(() => buildMigrationPlan(incomplete), /Order reference count mismatch/u);
    const stock = structuredClone(report);
    stock.ownershipEvidence.stock.levels.rows[0].stockOnHand += 1;
    assert.throws(() => buildMigrationPlan(stock), /conservation mismatch/u);
    report.ownershipEvidence.digital[0].lines.rows[0].channelIds = ['1'];
    assert.ok(
        buildMigrationPlan(report).digitalFiles[0].missingFacts.includes(
            'historical-delivery-channel-conflict',
        ),
    );
    report.ownershipEvidence.digital[0].lines.rows[0].channelIds = ['missing'];
    assert.throws(() => buildMigrationPlan(report), /Unknown reference Channel/u);
});

test('malformed processor configuration never leaks its raw value through an error', () => {
    const empty = { available: true, rows: [] };
    const evidence = {
        customers: { login: empty, addresses: empty, orders: empty, relations: {} },
        stock: { levels: empty, movements: empty },
        configuration: [
            {
                resource: 'paymentMethods',
                entityId: 1,
                configuration: { handler: 'PRIVATE_INVALID_VALUE' },
                history: empty,
            },
        ],
        digital: [],
    };
    assert.throws(
        () => redactOwnershipEvidence(evidence, () => 'ref', 'fixture-key'),
        error => {
            assert.equal(error.message, 'Invalid configuration JSON; inventory stopped');
            return true;
        },
    );
});

test('wallet-linked records are inventoried even when their customer foreign key disagrees', async () => {
    const report = await collectFixture(true);
    assert.equal(report.ownershipEvidence.customers.relations.referral_withdrawal.rows.length, 1);
    assert.ok(buildMigrationPlan(report).customers[0].missingFacts.includes('wallet-reference-mismatch'));
});

test('expanded customer inventory collects business and authentication references and matches addresses without personal data', async () => {
    const report = await fixture;
    const dependencies = report.ownershipEvidence.customers.dependencies;
    for (const table of [
        'customer_delivery_email',
        'after_sales_request',
        'customer_coupon',
        'coupon_ledger_entry',
        'coupon_order_allocation',
        'storefront_daily_visitor',
        'customer_groups_customer_group',
        'history_entry',
        'authentication_method',
        'session',
        'user_roles_role',
        'role',
    ]) {
        assert.equal(dependencies.groups[table].rows.length, 1, table);
    }
    const address = dependencies.addressMatches.rows[0];
    assert.match(address.fingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(address.candidateChannelIds, ['1']);
    assert.deepEqual(address.reasons, []);
    assert.equal(address.matches[0].orderRef, dependencies.groups.after_sales_request.rows[0].orderRef);
    assert.doesNotMatch(
        JSON.stringify(dependencies),
        /PRIVATE_|passwordHash|verificationToken|apiKeyHash|"(?:token|customerId|userId)"\s*:/u,
    );
    assert.equal(buildMigrationPlan(report).readyForExecution, false);
});

test('missing dependency table or column never becomes a confirmed empty inventory', async () => {
    const missingTable = await collectFixture(false, 'DROP TABLE customer_delivery_email');
    assert.ok(
        buildMigrationPlan(missingTable).customers[0].missingFacts.includes(
            'missing-dependency:customer_delivery_email',
        ),
    );
    const missingColumn = await collectFixture(
        false,
        'ALTER TABLE session RENAME COLUMN activeOrderId TO removedColumn',
    );
    assert.ok(
        buildMigrationPlan(missingColumn).customers[0].missingFacts.includes('missing-dependency:session'),
    );
});

test('address copies across stores and a multi-channel order remain explicit ambiguities', async () => {
    const report = await collectFixture(
        false,
        'UPDATE `order` SET shippingAddress = (SELECT shippingAddress FROM `order` WHERE id=101) WHERE id=102',
    );
    const address = report.ownershipEvidence.customers.dependencies.addressMatches.rows[0];
    assert.deepEqual(address.candidateChannelIds, ['1', '2']);
    assert.ok(buildMigrationPlan(report).customers[0].missingFacts.includes('address-copy-review-required'));
    const ambiguous = await collectFixture(false, 'INSERT INTO order_channels_channel VALUES (101, 2)');
    assert.ok(
        ambiguous.ownershipEvidence.customers.dependencies.addressMatches.rows[0].reasons.includes(
            'ambiguous-order-channel',
        ),
    );
});

test('malformed, unmatched and unknown address fields are not exposed or guessed', async () => {
    const malformed = await collectFixture(
        false,
        "UPDATE `order` SET shippingAddress='PRIVATE_INVALID_ADDRESS' WHERE id=101",
    );
    assert.ok(
        buildMigrationPlan(malformed).customers[0].missingFacts.includes('address-snapshot-review-required'),
    );
    const unmatched = await collectFixture(false, "UPDATE address SET postalCode='0100'");
    assert.deepEqual(
        unmatched.ownershipEvidence.customers.dependencies.addressMatches.rows[0].candidateChannelIds,
        [],
    );
    const unknown = await collectFixture(
        false,
        `UPDATE \`order\` SET shippingAddress='{"streetLine1":"PRIVATE_ADDRESS_CANARY","countryCode":"MY",
            "customFields":{"customerRef":"PRIVATE_REFERENCE_CANARY"}}' WHERE id=101`,
    );
    assert.ok(
        buildMigrationPlan(unknown).customers[0].missingFacts.includes('address-snapshot-review-required'),
    );
});

test('unknown foreign keys, soft identifiers and opaque columns keep reference closure blocked', async () => {
    const report = await collectFixture(
        false,
        `CREATE TABLE unreviewed_plugin (id INTEGER, person INTEGER REFERENCES customer(id), ownerAddressRef TEXT, metadata TEXT)`,
    );
    const dependencies = report.ownershipEvidence.customers.dependencies;
    assert.equal(
        dependencies.schema.edges.filter(edge => edge.tableName === 'unreviewed_plugin' && !edge.handled)
            .length,
        2,
    );
    assert.ok(
        buildMigrationPlan(report).customers[0].missingFacts.includes(
            'unknown-customer-user-address-reference',
        ),
    );
    assert.ok(
        buildMigrationPlan(report).customers[0].missingFacts.includes('opaque-reference-review-required'),
    );
    for (const edge of dependencies.schema.edges) edge.handled = true;
    assert.ok(
        buildMigrationPlan(report).customers[0].missingFacts.includes(
            'unknown-customer-user-address-reference',
        ),
    );
});

test('coupon references are reverse-checked and dependent orders cannot silently change store or customer', async () => {
    const report = await collectFixture(
        false,
        `UPDATE coupon_ledger_entry SET customerId=12;
        UPDATE after_sales_request SET channelId=2;
        INSERT INTO channel VALUES (3, 'store-c');
        UPDATE customer_delivery_email SET channelId=3`,
    );
    assert.equal(report.ownershipEvidence.customers.dependencies.groups.coupon_ledger_entry.rows.length, 1);
    const facts = buildMigrationPlan(report).customers[0].missingFacts;
    for (const expected of [
        'coupon-reference-mismatch',
        'cross-channel-order-dependency',
        'cross-channel-customer-dependency',
    ])
        assert.ok(facts.includes(expected), expected);
});

test('administrator, external authentication, API keys, elevated roles and foreign session orders require review without secrets', async () => {
    const report = await collectFixture(
        false,
        `INSERT INTO administrator VALUES (901, 91, NULL);
        INSERT INTO api_key VALUES (902, 92, 91, NULL, 'PRIVATE_API_KEY_CANARY');
        INSERT INTO api_key_channels_channel VALUES (902, 2);
        UPDATE authentication_method SET type='ExternalAuthenticationMethod';
        UPDATE role SET permissions='SuperAdmin';
        INSERT INTO \`order\` VALUES (103, 12, '{}', '{}');
        INSERT INTO order_channels_channel VALUES (103, 2);
        UPDATE session SET activeOrderId=103`,
    );
    const facts = buildMigrationPlan(report).customers[0].missingFacts;
    for (const expected of [
        'administrator-customer-identity-overlap',
        'customer-api-key-review',
        'non-native-customer-authentication',
        'customer-role-permission-review',
        'cross-customer-session-order',
    ])
        assert.ok(facts.includes(expected), expected);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/u);
});

test('MySQL relation discovery is metadata-only and binds inspection to the current database', async () => {
    const queries = [];
    const schema = await collectCustomerRelationSchema({
        kind: 'mysql',
        query: async sql => {
            queries.push(sql);
            assert.match(sql, /WHERE TABLE_SCHEMA = DATABASE\(\)/u);
            assert.match(sql.trim(), /^SELECT /u);
            if (sql.includes('information_schema.columns'))
                return [{ tableName: 'plugin', columnName: 'relatedUserId', dataType: 'int' }];
            return [{ tableName: 'plugin', columnName: 'owner', targetTable: 'address', targetColumn: 'id' }];
        },
    });
    assert.equal(queries.length, 2);
    assert.equal(schema.edges.filter(edge => !edge.handled).length, 2);
    assert.equal(schema.softReferenceClosure, 'unproven');
});

test('history, business records and anonymous sessions are reverse-collected from affected orders', async () => {
    const report = await collectFixture(
        false,
        `UPDATE after_sales_request SET customerId=12;
        INSERT INTO history_entry VALUES (732, NULL, 101, NULL, 'ORDER_STATE_TRANSITION', 0, 'PRIVATE_HISTORY_CANARY');
        INSERT INTO session VALUES (752, NULL, 101, 1, 0, '2026-09-14', NULL, 'PRIVATE_ANONYMOUS_SESSION_CANARY')`,
    );
    const groups = report.ownershipEvidence.customers.dependencies.groups;
    assert.equal(groups.after_sales_request.rows.length, 1);
    assert.equal(groups.history_entry.rows.length, 2);
    assert.equal(groups.session.rows.length, 2);
    const facts = buildMigrationPlan(report).customers[0].missingFacts;
    assert.ok(facts.includes('cross-channel-order-dependency'));
    assert.ok(facts.includes('foreign-session-customer-order'));
});
