import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildStoreIsolationPreflight,
    collectStoreIsolationSnapshot,
} from './store-isolation-data-preflight.mjs';
import { buildMigrationPlan } from './store-isolation-migration-plan.mjs';

// This entry point has no database URL, external input database, SQL argument, apply mode or network client.
// Only a fresh in-memory database built from the fixed synthetic fixture can enter the executor.
const sources = new WeakMap();
const fixtureUrl = new URL('./store-isolation-rehearsal-fixture.sql', import.meta.url);
const APPROVED_FIXTURE_SHA256 = '06b9270ff3a8fc04985f68e173381bcbbb857a5f3853a25a6618db8650a8e6be';
const reportRoot = fileURLToPath(new URL('../../../reports/pending-migrations-20260913/', import.meta.url));

const KEYS = {
    customer_channels_channel: ['customerId', 'channelId'],
    stock_location_channels_channel: ['stockLocationId', 'channelId'],
    customer_groups_customer_group: ['customerId', 'customerGroupId'],
};
const MUTABLE = {
    customer_channels_channel: ['customerId'],
    address: ['customerId'],
    order: ['customerId'],
    referral_account: ['customerId'],
    referral_wallet: ['customerId'],
    referral_ledger_entry: ['customerId'],
    referral_relationship: ['inviterCustomerId', 'inviteeCustomerId'],
    referral_reward: ['inviterCustomerId', 'inviteeCustomerId'],
    referral_balance_use: ['customerId'],
    referral_wallet_usage: ['customerId'],
    referral_withdrawal: ['customerId'],
    customer_delivery_email: ['customerId'],
    after_sales_request: ['customerId'],
    customer_coupon: ['customerId'],
    coupon_ledger_entry: ['customerId'],
    coupon_order_allocation: ['customerId'],
    storefront_daily_visitor: ['customerId'],
    customer_groups_customer_group: ['customerId'],
    history_entry: ['customerId'],
    stock_level: ['stockLocationId'],
    stock_movement: ['stockLocationId'],
    stock_location_channels_channel: ['stockLocationId'],
};

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonical(value[key])]),
        );
    return value;
}
function digest(value) {
    return createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
}
function quote(name) {
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9_]*$/u, 'Unsafe rehearsal identifier');
    return `\`${name}\``;
}
function query(database, sql, parameters = []) {
    const statement = database.prepare(sql);
    try {
        statement.bind(parameters);
        const rows = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
    } finally {
        statement.free();
    }
}
function inventory(database) {
    const tables = query(
        database,
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return Object.fromEntries(
        tables.map(table => [
            table.name,
            {
                schema: table.sql,
                rows: query(database, `SELECT * FROM ${quote(table.name)}`).sort((a, b) =>
                    JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))),
                ),
            },
        ]),
    );
}
function adapter(database) {
    return {
        kind: 'sqlite',
        query: async (sql, parameters) => {
            assert.match(sql.trim(), /^(SELECT|PRAGMA)\b/u, 'Preflight attempted a write');
            return query(database, sql, parameters);
        },
        tableExists: async name =>
            query(database, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]).length >
            0,
        columnExists: async (table, column) =>
            query(database, `PRAGMA table_info(${quote(table)})`).some(row => row.name === column),
    };
}
function operation(table, key, column, before, after) {
    return {
        table,
        key,
        column,
        before,
        after,
        channelId: '2',
        ownershipEvidence: `synthetic-explicit-store-b:${table}:${JSON.stringify(key)}`,
    };
}
function approvedOperations() {
    return [
        operation('customer_channels_channel', { customerId: 11, channelId: 2 }, 'customerId', 11, 21),
        operation('address', { id: 202 }, 'customerId', 11, 21),
        operation('order', { id: 102 }, 'customerId', 11, 21),
        ...[
            ['referral_account', 301],
            ['referral_wallet', 311],
            ['referral_wallet', 312],
            ['referral_ledger_entry', 321],
            ['referral_ledger_entry', 322],
            ['customer_delivery_email', 802],
            ['after_sales_request', 803],
            ['customer_coupon', 811],
            ['coupon_ledger_entry', 812],
            ['coupon_order_allocation', 813],
            ['storefront_daily_visitor', 821],
            ['history_entry', 832],
        ].map(([table, id]) => operation(table, { id }, 'customerId', 11, 21)),
        operation('referral_relationship', { id: 331 }, 'inviteeCustomerId', 11, 21),
        operation(
            'customer_groups_customer_group',
            { customerId: 11, customerGroupId: 802 },
            'customerId',
            11,
            21,
        ),
        operation(
            'stock_location_channels_channel',
            { stockLocationId: 41, channelId: 2 },
            'stockLocationId',
            41,
            42,
        ),
        operation('stock_level', { id: 401 }, 'stockLocationId', 41, 42),
        operation('stock_movement', { id: 411 }, 'stockLocationId', 41, 42),
        operation('stock_movement', { id: 412 }, 'stockLocationId', 41, 42),
    ];
}
function rowMatches(row, key) {
    return Object.entries(key).every(([name, value]) => row[name] === value);
}
function projectChanges(before, operations) {
    const result = structuredClone(before);
    const seen = new Set();
    for (const op of operations) {
        assert.ok(MUTABLE[op.table]?.includes(op.column), 'Protected or unknown mutation');
        assert.deepEqual(
            Object.keys(op.key).sort(),
            (KEYS[op.table] ?? ['id']).slice().sort(),
            'Incomplete row key',
        );
        assert.ok(op.ownershipEvidence && op.channelId === '2', 'Missing explicit ownership');
        const identity = JSON.stringify([op.table, canonical(op.key), op.column]);
        assert.ok(!seen.has(identity), 'Duplicate operation');
        seen.add(identity);
        const rows = result[op.table]?.rows.filter(row => rowMatches(row, op.key)) ?? [];
        assert.equal(rows.length, 1, 'Expected exactly one source row');
        assert.equal(rows[0][op.column], op.before, 'Source reference drift');
        rows[0][op.column] = op.after;
    }
    for (const table of Object.values(result))
        table.rows.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
    return result;
}
function assertOwnership(state) {
    const customerChannels = state.customer_channels_channel.rows;
    const customers = state.customer.rows;
    const orders = state.order.rows;
    for (const [table, value] of Object.entries(state)) {
        for (const row of value.rows) {
            for (const column of ['customerId', 'inviterCustomerId', 'inviteeCustomerId']) {
                if (row[column] == null) continue;
                assert.ok(
                    customers.some(item => item.id === row[column]),
                    'Dangling customer reference',
                );
                if (row.channelId != null)
                    assert.ok(
                        customerChannels.some(
                            item => item.customerId === row[column] && item.channelId === row.channelId,
                        ),
                        'Cross-store customer reference',
                    );
            }
            if (row.orderId != null && row.customerId != null)
                assert.ok(
                    orders.some(order => order.id === row.orderId && order.customerId === row.customerId),
                    'Order/customer reference mismatch',
                );
            if (row.walletId != null)
                assert.ok(
                    state.referral_wallet.rows.some(
                        wallet =>
                            wallet.id === row.walletId &&
                            wallet.customerId === row.customerId &&
                            wallet.channelId === row.channelId &&
                            wallet.currencyCode === row.currencyCode,
                    ),
                    'Wallet reference mismatch',
                );
            if (row.customerCouponId != null)
                assert.ok(
                    state.customer_coupon.rows.some(
                        coupon =>
                            coupon.id === row.customerCouponId &&
                            coupon.customerId === row.customerId &&
                            coupon.channelId === row.channelId,
                    ),
                    'Coupon reference mismatch',
                );
            if (row.stockLocationId != null && table !== 'stock_location_channels_channel')
                assert.ok(
                    state.stock_location.rows.some(location => location.id === row.stockLocationId),
                    'Dangling stock location',
                );
        }
    }
    for (const wallet of state.referral_wallet.rows) {
        const entries = state.referral_ledger_entry.rows.filter(entry => entry.walletId === wallet.id);
        for (const [balance, delta] of [
            ['availableBalance', 'availableDelta'],
            ['pendingBalance', 'pendingDelta'],
            ['reservedBalance', 'reservedDelta'],
        ]) {
            let total = 0;
            for (const entry of entries) {
                assert.ok(Number.isSafeInteger(entry[delta]), 'Unsafe ledger amount');
                total += entry[delta];
                assert.ok(Number.isSafeInteger(total), 'Unsafe ledger total');
            }
            assert.equal(total, wallet[balance], 'Wallet ledger reconciliation failed');
        }
    }
    assert.equal(customers.find(row => row.id === 11)?.userId, 91, 'Original login moved');
    assert.equal(customers.find(row => row.id === 21)?.userId, null, 'Destination guest gained a login');
}

function protectedSummary(state) {
    const tableDigests = {};
    for (const [table, value] of Object.entries(state)) {
        const rows = value.rows.map(row =>
            Object.fromEntries(Object.entries(row).filter(([column]) => !MUTABLE[table]?.includes(column))),
        );
        rows.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
        tableDigests[table] = digest({ schema: value.schema, rows });
    }
    const walletsByCurrency = {};
    for (const wallet of state.referral_wallet.rows) {
        const totals = walletsByCurrency[wallet.currencyCode] ?? [0, 0, 0];
        for (const [index, column] of ['availableBalance', 'pendingBalance', 'reservedBalance'].entries()) {
            assert.ok(Number.isSafeInteger(wallet[column]), 'Unsafe wallet balance');
            totals[index] += wallet[column];
            assert.ok(Number.isSafeInteger(totals[index]), 'Unsafe wallet total');
        }
        walletsByCurrency[wallet.currencyCode] = totals;
    }
    return { tableDigests, walletsByCurrency };
}

// Pure fixed-fixture helpers shared with the separately guarded local MySQL lab.
// This does not authorize external sources in openSyntheticRehearsal.
export { approvedOperations, assertOwnership, canonical, digest, projectChanges, protectedSummary, quote };
export async function syntheticFixtureState() {
    const { source } = await createSyntheticRehearsalSource();
    return structuredClone(sources.get(source).state);
}

export async function createSyntheticRehearsalSource() {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const fixtureSql = await readFile(fixtureUrl, 'utf8');
    assert.equal(
        createHash('sha256').update(fixtureSql).digest('hex'),
        APPROVED_FIXTURE_SHA256,
        'Synthetic source is not the inspected fixture',
    );
    const database = new SQL.Database();
    database.run(fixtureSql);
    const state = inventory(database);
    const snapshot = await collectStoreIsolationSnapshot(adapter(database));
    const preflight = buildStoreIsolationPreflight(snapshot, 'synthetic-rehearsal-only');
    const plan = buildMigrationPlan(preflight);
    const reviewedCustomerFacts = new Set([
        'one-to-one-login-split-strategy',
        'address-ownership',
        'soft-reference-source-review-required',
        'opaque-reference-review-required',
        'customer-group-assignment-review',
    ]);
    for (const blocker of plan.missingFacts) {
        const scopeExclusion =
            ['products', 'collections', 'sellers'].includes(blocker.resource) &&
            blocker.facts.length === 1 &&
            blocker.facts[0] === 'relation-inventory';
        const noFileOperation =
            blocker.resource === 'digitalDelivery' &&
            blocker.facts.length === 1 &&
            blocker.facts[0] === 'digital-directory-inventory';
        assert.ok(
            scopeExclusion ||
                noFileOperation ||
                (blocker.resource === 'customers' &&
                    blocker.facts.every(fact => reviewedCustomerFacts.has(fact))),
            'Unknown or unresolved fixture planning fact',
        );
    }
    const source = {};
    const review = {
        scope: 'fixed-synthetic-fixture-only',
        sourceSqlSha256: APPROVED_FIXTURE_SHA256,
        schemaSha256: digest(
            Object.fromEntries(Object.entries(state).map(([table, value]) => [table, value.schema])),
        ),
        inventorySha256: digest(state),
        referenceCoverage: Object.keys(state).sort(),
        reviewedPlanningBlockers: plan.missingFacts, // Bound only to this inspected synthetic input, never a production waiver.
        unreviewedFields: [],
        unknownDependencies: [],
        loginDecision: {
            originalCustomer: 11,
            originalUser: 91,
            retainChannel: '1',
            targetCustomer: 21,
            targetChannel: '2',
            targetUser: null,
        },
    };
    const manifest = {
        format: 1,
        mode: 'synthetic-rehearsal-only',
        sourceSha256: digest(state),
        review,
        operations: approvedOperations(),
        icloud: { policy: 'platform-shared', action: 'retain-existing-records-and-relations' },
    };
    projectChanges(state, manifest.operations);
    sources.set(source, {
        SQL,
        bytes: database.export(),
        state,
        manifest: structuredClone(manifest),
        preflight,
        plan,
    });
    database.close();
    return { source, manifest, preflight, plan };
}

export function openSyntheticRehearsal(source, suppliedManifest) {
    const owned = sources.get(source);
    assert.ok(owned, 'Only an internally generated synthetic source is accepted');
    const manifest = structuredClone(suppliedManifest);
    assert.equal(manifest.mode, 'synthetic-rehearsal-only', 'No production or apply mode');
    assert.equal(digest(manifest), digest(owned.manifest), 'Manifest is not the reviewed synthetic mapping');
    const database = new owned.SQL.Database(owned.bytes);
    let journal = null;
    let closed = false;
    const manifestSha256 = digest(manifest);
    const baseline = owned.state;
    const projected = projectChanges(baseline, manifest.operations);
    assertOwnership(projected);
    const afterSha256 = digest(projected);
    const ensureOpen = () => assert.ok(!closed, 'Rehearsal already closed');
    const stateDigest = () => digest(inventory(database));
    function update(op, reverse) {
        const key = { ...op.key };
        if (reverse && Object.hasOwn(key, op.column)) key[op.column] = op.after;
        const previous = reverse ? op.after : op.before;
        const next = reverse ? op.before : op.after;
        const where = [...Object.keys(key).map(name => `${quote(name)} = ?`), `${quote(op.column)} = ?`].join(
            ' AND ',
        );
        database.run(`UPDATE ${quote(op.table)} SET ${quote(op.column)} = ? WHERE ${where}`, [
            next,
            ...Object.values(key),
            previous,
        ]);
        assert.equal(database.getRowsModified(), 1, 'Affected row count changed');
    }
    return {
        plan() {
            ensureOpen();
            assert.equal(stateDigest(), manifest.sourceSha256, 'Baseline drift');
            return {
                mode: 'plan-only',
                source: 'fixed-synthetic-fixture',
                manifestSha256,
                sourceSha256: manifest.sourceSha256,
                plannedUpdates: manifest.operations.length,
                productionReady: false,
                databaseChanged: false,
            };
        },
        rehearse({ failAfterWrite } = {}) {
            ensureOpen();
            if (journal?.status === 'applied') {
                assert.equal(stateDigest(), journal.afterSha256, 'State drift after commit');
                return structuredClone({ ...journal, status: 'already-applied' });
            }
            assert.ok(
                failAfterWrite === undefined ||
                    (Number.isSafeInteger(failAfterWrite) &&
                        failAfterWrite > 0 &&
                        failAfterWrite <= manifest.operations.length),
                'Invalid failure injection',
            );
            assert.equal(stateDigest(), manifest.sourceSha256, 'Baseline drift');
            database.run('BEGIN IMMEDIATE');
            try {
                assert.equal(stateDigest(), manifest.sourceSha256, 'Baseline drift in transaction');
                for (const [index, op] of manifest.operations.entries()) {
                    update(op, false);
                    if (index + 1 === failAfterWrite)
                        throw new Error('Injected synthetic transaction failure');
                }
                assert.deepEqual(
                    inventory(database),
                    projected,
                    'Protected data or reference conservation failed',
                );
                assertOwnership(inventory(database));
                database.run('COMMIT');
            } catch (error) {
                database.run('ROLLBACK');
                assert.equal(
                    stateDigest(),
                    manifest.sourceSha256,
                    'Failed transaction did not restore baseline',
                );
                throw error;
            }
            journal = {
                format: 1,
                mode: 'synthetic-rehearsal-only',
                status: 'applied',
                manifestSha256,
                beforeSha256: manifest.sourceSha256,
                afterSha256,
                operations: structuredClone(manifest.operations),
                preservedRows: true,
                protectedColumnsUnchanged: true,
                productionReady: false,
            };
            return structuredClone(journal);
        },
        rollback(receipt, { failAfterWrite } = {}) {
            ensureOpen();
            assert.ok(journal && journal.status === 'applied', 'No committed rehearsal to reverse');
            assert.equal(digest(receipt), digest(journal), 'Unrecognized or changed rollback journal');
            assert.equal(stateDigest(), journal.afterSha256, 'Refusing rollback over later changes');
            assert.ok(
                failAfterWrite === undefined ||
                    (Number.isSafeInteger(failAfterWrite) &&
                        failAfterWrite > 0 &&
                        failAfterWrite <= manifest.operations.length),
                'Invalid failure injection',
            );
            database.run('BEGIN IMMEDIATE');
            try {
                for (const [index, op] of [...manifest.operations].reverse().entries()) {
                    update(op, true);
                    if (index + 1 === failAfterWrite) throw new Error('Injected synthetic rollback failure');
                }
                assert.deepEqual(
                    inventory(database),
                    baseline,
                    'Rollback did not restore every original row',
                );
                database.run('COMMIT');
            } catch (error) {
                database.run('ROLLBACK');
                assert.equal(
                    stateDigest(),
                    journal.afterSha256,
                    'Rollback failure changed the committed state',
                );
                throw error;
            }
            journal = { ...journal, status: 'rolled-back' };
            return {
                status: 'rolled-back',
                restoredSha256: stateDigest(),
                sourcePreserved: true,
                productionReady: false,
            };
        },
        summary() {
            ensureOpen();
            const state = inventory(database);
            return {
                sha256: digest(state),
                rows: Object.fromEntries(
                    Object.entries(state).map(([table, value]) => [table, value.rows.length]),
                ),
                protected: protectedSummary(state),
                originalSourceUnchanged: digest(owned.state) === manifest.sourceSha256,
            };
        },
        simulateSyntheticDrift() {
            ensureOpen();
            database.run('UPDATE `order` SET subTotal = subTotal + 1 WHERE id = 101');
        },
        close() {
            if (!closed) database.close();
            closed = true;
        },
    };
}

async function main() {
    const args = process.argv.slice(2);
    const rehearse = args[0] === '--rehearse';
    if (rehearse) args.shift();
    assert.ok(
        args.length === 2 && args[0] === '--output',
        'Usage: store-isolation-rehearsal.mjs [--rehearse] --output <absolute-project-report.json>',
    );
    const output = args[1];
    assert.ok(
        path.isAbsolute(output) && path.extname(output) === '.json',
        'Use an absolute JSON report path',
    );
    await mkdir(reportRoot, { recursive: true });
    const realRoot = await realpath(reportRoot);
    assert.equal(
        await realpath(path.dirname(output)),
        realRoot,
        'Output must be in this project rehearsal report directory',
    );
    const fixture = await createSyntheticRehearsalSource();
    const engine = openSyntheticRehearsal(fixture.source, fixture.manifest);
    try {
        const result = {
            plan: engine.plan(),
            sourcePlanningBlockers: fixture.plan.missingFacts,
            productionReady: false,
        };
        if (rehearse) {
            const before = engine.summary();
            result.applied = engine.rehearse();
            result.retry = engine.rehearse().status;
            result.rollback = engine.rollback(result.applied);
            assert.deepEqual(engine.summary(), before, 'Synthetic source not restored');
        }
        await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        process.stdout.write(
            JSON.stringify({
                mode: rehearse ? 'synthetic-rehearsal' : 'plan-only',
                updates: fixture.manifest.operations.length,
                productionReady: false,
                output,
            }) + '\n',
        );
    } finally {
        engine.close();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        process.stderr.write('Synthetic rehearsal failed; no production operation was attempted.\n');
        process.exitCode = 1;
    });
}
