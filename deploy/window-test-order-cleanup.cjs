'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');

// Disposable orders explicitly authorized in this window. This is not a general purge entry.
const TARGETS = Object.freeze([
    { id: '22', code: 'YFRETX1XZJ9D19N7' },
    { id: '47', code: 'QW6DDTSAQE2RZYNC' },
    { id: '48', code: 'JASP65WDHHU3H2AP' },
    { id: '49', code: 'Y5DBD95AC2VYVF34' },
]);
const DERIVED = new Set([
    'order',
    'order_line',
    'shipping_line',
    'surcharge',
    'payment',
    'refund',
    'order_modification',
    'history_entry',
    'fulfillment',
    'fulfillment_line',
    'order_channels_channel',
    'order_promotions_promotion',
    'order_fulfillments_fulfillment',
    'stock_movement',
    'catalog_inventory_lot_movement',
    'catalog_order_profit_expense',
    'catalog_order_profit_expense_event',
    'auto_card_delivery',
    'auto_card_delivery_event',
    'auto_card_supply_snapshot',
    'manual_digital_delivery',
    'manual_digital_delivery_event',
    'digital_order_reservation',
    'digital_receipt_access',
    'checkout_resource_hold',
    'after_sales_request',
    'after_sales_item',
    'after_sales_event',
    'after_sales_evidence',
    'fulfillment_delivery_record',
    'fulfillment_delivery_event',
    'coupon_order_allocation',
    'coupon_ledger_entry',
    'storefront_order_attribution',
    'customer_service_review',
    'customer_service_feedback',
    'fraud_risk_case',
    'fraud_risk_case_event',
    'fraud_risk_appeal',
    'storefront_cart_checkout',
    'storefront_cart_checkout_line',
    'storefront_payment_attempt',
    'storefront_cart_command_receipt',
    'admin_notification_outbox',
    // Incident workflow evidence/actions belong to the exact order-bound outbox parent.
    'admin_incident_evidence',
    'admin_incident_action',
    'store_notification_read',
    'governance_audit_entry',
]);
const RETAINED = new Set(['session', 'storefront_cart', 'storefront_cart_line', 'customer_coupon']);
const IMPLICIT = {
    orderId: 'order',
    activeOrderId: 'order',
    checkoutOrderId: 'order',
    lockedOrderId: 'order',
    usedOrderId: 'order',
    orderLineId: 'order_line',
    paymentId: 'payment',
    refundId: 'refund',
    fulfillmentId: 'fulfillment',
    checkoutId: 'storefront_cart_checkout',
    stockMovementId: 'stock_movement',
};
const SEMANTIC = {
    Order: 'order',
    Payment: 'payment',
    Refund: 'refund',
    Fulfillment: 'fulfillment',
    FraudRiskCase: 'fraud_risk_case',
    AfterSalesRequest: 'after_sales_request',
};
const quote = name => {
    assert.match(name, /^[A-Za-z0-9_]+$/u);
    return '`' + name + '`';
};
function canonical(value) {
    if (Buffer.isBuffer(value)) return { binary: value.toString('base64') };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonical(value[key])]),
        );
    return typeof value === 'bigint' ? String(value) : value;
}
const digest = value =>
    createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
const keyOf = (table, row) => digest(table.primaryKeys.map(column => row[column]));
const parseJson = value => {
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return null;
    }
};

function references(table) {
    const refs = [...table.foreignKeys];
    for (const [column, target] of Object.entries(IMPLICIT))
        if (table.columns.includes(column) && !refs.some(ref => ref.columns.includes(column)))
            refs.push({ columns: [column], target, targetColumns: ['id'] });
    const parents = {
        manual_digital_delivery_event: ['deliveryId', 'manual_digital_delivery'],
        auto_card_delivery_event: ['deliveryId', 'auto_card_delivery'],
        after_sales_item: ['requestId', 'after_sales_request'],
        after_sales_event: ['requestId', 'after_sales_request'],
        after_sales_evidence: ['requestId', 'after_sales_request'],
    };
    const parent = parents[table.name];
    if (parent && table.columns.includes(parent[0]) && !refs.some(ref => ref.columns.includes(parent[0])))
        refs.push({ columns: [parent[0]], target: parent[1], targetColumns: ['id'] });
    return refs;
}

async function queryRows(connection, sql, values = [], limit = 2000) {
    const [rows] = await connection.query(sql, values);
    assert.ok(Array.isArray(rows) && rows.length <= limit, 'CLEANUP_READ_LIMIT');
    return rows;
}
async function schema(connection) {
    const columns = await queryRows(
        connection,
        `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
        COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue,
        EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [],
        10000,
    );
    const tables = new Map();
    for (const column of columns) {
        const table = tables.get(column.tableName) || {
            name: column.tableName,
            columns: [],
            definitions: [],
            primaryKeys: [],
            foreignKeys: [],
        };
        table.columns.push(column.columnName);
        table.definitions.push(column);
        tables.set(table.name, table);
    }
    const constraints = await queryRows(
        connection,
        `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
        COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS target, REFERENCED_COLUMN_NAME AS targetColumn
        FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
        [],
        10000,
    );
    for (const item of constraints) {
        const table = tables.get(item.tableName);
        if (item.constraintName === 'PRIMARY') table.primaryKeys.push(item.columnName);
        if (!item.target) continue;
        let ref = table.foreignKeys.find(entry => entry.name === item.constraintName);
        if (!ref) {
            ref = { name: item.constraintName, target: item.target, columns: [], targetColumns: [] };
            table.foreignKeys.push(ref);
        }
        ref.columns.push(item.columnName);
        ref.targetColumns.push(item.targetColumn);
    }
    return [...tables.values()];
}

async function collectGraph(connection, lock = false) {
    const tables = await schema(connection);
    const catalog = new Map(tables.map(table => [table.name, table]));
    assert.ok(catalog.has('order'), 'ORDER_TABLE_MISSING');
    const rows = Object.fromEntries(tables.map(table => [table.name, new Map()]));
    const add = (name, found) => {
        const table = catalog.get(name);
        assert.ok(table.primaryKeys.length || !found.length, `PRIMARY_KEY_REQUIRED:${name}`);
        let changed = false;
        for (const row of found) {
            const key = keyOf(table, row);
            if (!rows[name].has(key)) {
                rows[name].set(key, row);
                changed = true;
            }
        }
        return changed;
    };
    const suffix = lock ? ' FOR UPDATE' : '';
    const read = (table, where, values) => {
        const retainedColumns = {
            session: ['id', 'activeOrderId'],
            storefront_cart: ['id', 'checkoutOrderId', 'projectedRevision', 'state', 'revision'],
            storefront_cart_line: ['id', 'orderLineId'],
            customer_coupon: [
                'id',
                'lockedOrderId',
                'usedOrderId',
                'lockedAt',
                'lockExpiresAt',
                'usedAt',
                'status',
            ],
        }[table];
        const select = retainedColumns
            ? retainedColumns
                  .filter(column => catalog.get(table).columns.includes(column))
                  .map(quote)
                  .join(',')
            : '*';
        return queryRows(
            connection,
            `SELECT ${select} FROM ${quote(table)} WHERE ${where} LIMIT 2001${suffix}`,
            values,
        );
    };
    add(
        'order',
        await read(
            'order',
            'id IN (?,?,?,?)',
            TARGETS.map(target => target.id),
        ),
    );
    const original = [...rows.order.values()];
    for (const ref of catalog.get('order').foreignKeys.filter(ref => ref.target === 'order'))
        for (const order of original) {
            const found = await read(
                'order',
                ref.columns.map(column => `${quote(column)} = ?`).join(' AND '),
                ref.targetColumns.map(column => order[column]),
            );
            assert.ok(
                found.every(row => TARGETS.some(target => target.id === String(row.id))),
                'SHARED_ORDER_REFERENCE',
            );
        }
    for (const target of TARGETS) {
        const order = original.find(row => String(row.id) === target.id);
        assert.ok(order && order.code === target.code, `EXACT_ORDER_MISMATCH:${target.id}`);
        assert.equal(String(order.salesChannelId), '5', `CHANNEL_MISMATCH:${target.id}`);
        assert.equal(order.currencyCode, 'CNY', `CURRENCY_MISMATCH:${target.id}`);
    }
    let changed = true;
    for (let round = 0; changed; round++) {
        assert.ok(round < 20, 'CLEANUP_GRAPH_LIMIT');
        changed = false;
        for (const table of tables) {
            if (table.name === 'order') continue;
            for (const ref of references(table)) {
                if (!DERIVED.has(ref.target)) continue;
                for (const parent of rows[ref.target]?.values() || []) {
                    const values = ref.targetColumns.map(column => parent[column]);
                    if (values.some(value => value == null)) continue;
                    const found = await read(
                        table.name,
                        ref.columns.map(column => `${quote(column)} = ?`).join(' AND '),
                        values,
                    );
                    changed = add(table.name, found) || changed;
                }
            }
            if (
                ['customer_service_review', 'customer_service_feedback'].includes(table.name) &&
                table.columns.includes('orderCode')
            )
                changed =
                    add(
                        table.name,
                        await read(
                            table.name,
                            'orderCode IN (?,?,?,?)',
                            TARGETS.map(target => target.code),
                        ),
                    ) || changed;
            if (table.name === 'fraud_risk_case' && table.columns.includes('subjectId'))
                changed =
                    add(
                        table.name,
                        await read(
                            table.name,
                            "subjectType = 'ORDER' AND subjectId IN (?,?,?,?)",
                            TARGETS.map(target => target.id),
                        ),
                    ) || changed;
            if (['governance_audit_entry', 'admin_notification_outbox'].includes(table.name)) {
                const typeColumn = table.columns.includes('resourceType') ? 'resourceType' : 'sourceType';
                const idColumn = table.columns.includes('resourceId') ? 'resourceId' : 'sourceId';
                if (table.columns.includes(typeColumn) && table.columns.includes(idColumn))
                    for (const [type, source] of Object.entries(SEMANTIC))
                        for (const parent of rows[source]?.values() || [])
                            changed =
                                add(
                                    table.name,
                                    await read(
                                        table.name,
                                        `${quote(typeColumn)} = ? AND ${quote(idColumn)} = ?`,
                                        [type, String(parent.id)],
                                    ),
                                ) || changed;
                if (table.columns.includes('eventKey'))
                    for (const target of TARGETS)
                        changed =
                            add(
                                table.name,
                                await read(table.name, 'eventKey LIKE ?', [`ORDER:${target.id}:%`]),
                            ) || changed;
                if (table.columns.includes('payload'))
                    changed =
                        add(
                            table.name,
                            await read(
                                table.name,
                                "JSON_VALID(payload) AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.orderId')) IN (?,?,?,?)",
                                TARGETS.map(target => target.id),
                            ),
                        ) || changed;
            }
        }
    }
    const [identity] = await queryRows(
        connection,
        'SELECT DATABASE() AS databaseName, @@hostname AS hostName, @@port AS port, @@server_id AS serverId',
    );
    return {
        instance: digest(identity),
        tables,
        rows: Object.fromEntries(
            Object.entries(rows).map(([name, map]) => [
                name,
                [...map.values()].sort((a, b) =>
                    keyOf(catalog.get(name), a).localeCompare(keyOf(catalog.get(name), b)),
                ),
            ]),
        ),
    };
}

function buildPlan(graph) {
    const catalog = new Map(graph.tables.map(table => [table.name, table]));
    const blockers = [];
    const deletes = [];
    const patches = [];
    const block = (code, table) => blockers.push({ code, table });
    for (const [name, rows] of Object.entries(graph.rows)) {
        if (!rows.length) continue;
        if (DERIVED.has(name))
            deletes.push(
                ...rows.map(row => ({
                    table: name,
                    identity: Object.fromEntries(
                        catalog.get(name).primaryKeys.map(column => [column, row[column]]),
                    ),
                })),
            );
        else if (!RETAINED.has(name)) block('UNMAPPED_RELATION', name);
        else
            for (const row of rows) {
                let changes;
                if (name === 'session') changes = { activeOrderId: null };
                if (name === 'storefront_cart_line') changes = { orderLineId: null };
                if (name === 'storefront_cart')
                    changes = {
                        checkoutOrderId: null,
                        projectedRevision: null,
                        state: 'OPEN',
                        revision: Number(row.revision) + 1,
                    };
                if (
                    name === 'customer_coupon' &&
                    [row.lockedOrderId, row.usedOrderId].some(
                        id => id != null && !TARGETS.some(target => target.id === String(id)),
                    )
                )
                    block('SHARED_COUPON_REFERENCE', name);
                if (name === 'customer_coupon')
                    changes = {
                        lockedOrderId: null,
                        usedOrderId: null,
                        lockedAt: null,
                        lockExpiresAt: null,
                        usedAt: null,
                        status:
                            row.status === 'EXPIRED' || row.status === 'REVOKED' ? row.status : 'AVAILABLE',
                    };
                patches.push({
                    table: name,
                    identity: Object.fromEntries(
                        catalog.get(name).primaryKeys.map(column => [column, row[column]]),
                    ),
                    changes: Object.fromEntries(
                        Object.entries(changes).filter(([column]) =>
                            catalog.get(name).columns.includes(column),
                        ),
                    ),
                });
            }
    }
    for (const payment of graph.rows.payment || []) {
        const metadata = parseJson(payment.metadata) || {};
        if (
            !String(payment.method).startsWith('controlled-test-payment-') ||
            metadata.public?.testPayment !== true
        )
            block('NON_SIMULATED_PAYMENT', 'payment');
    }
    for (const name of [
        'refund',
        'fulfillment',
        'order_fulfillments_fulfillment',
        'auto_card_delivery',
        'manual_digital_delivery',
        'fulfillment_delivery_record',
    ])
        if (graph.rows[name]?.length) block('DELIVERY_OR_REFUND_REQUIRES_SEPARATE_REVIEW', name);
    const stockNets = new Map();
    for (const row of graph.rows.stock_movement || []) {
        if (!Number.isSafeInteger(Number(row.quantity))) {
            block('INVALID_STOCK_QUANTITY', 'stock_movement');
            continue;
        }
        if (!['ALLOCATION', 'RELEASE', 'SALE', 'CANCELLATION'].includes(row.type)) {
            block('UNMAPPED_STOCK_MOVEMENT', 'stock_movement');
            continue;
        }
        const key = `${row.productVariantId}:${row.stockLocationId}`;
        const net = stockNets.get(key) || { allocation: 0, onHand: 0 };
        if (['ALLOCATION', 'SALE'].includes(row.type)) net.allocation += Number(row.quantity);
        if (row.type === 'RELEASE') net.allocation -= Number(row.quantity);
        if (['SALE', 'CANCELLATION'].includes(row.type)) net.onHand += Number(row.quantity);
        stockNets.set(key, net);
    }
    for (const net of stockNets.values())
        if (net.allocation !== 0 || net.onHand !== 0) block('NONZERO_STOCK_BASELINE', 'stock_movement');
    if (graph.rows.catalog_inventory_lot_movement?.some(row => Number(row.quantity) !== 0))
        block('LOT_BASELINE_REQUIRES_RESTORATION', 'catalog_inventory_lot_movement');
    for (const row of graph.rows.digital_order_reservation || []) {
        if (row.stockPolicy === 'limited' && Number(row.quantity) !== Number(row.releasedQuantity))
            block('DIGITAL_QUOTA_STILL_RESERVED', 'digital_order_reservation');
        const poolIds = parseJson(row.poolItemIdsJson);
        if (Array.isArray(poolIds) && poolIds.length)
            block('RESERVED_SECRET_STOCK', 'digital_order_reservation');
    }
    const names = new Set(deletes.map(item => item.table));
    const deleteOrder = [];
    while (names.size) {
        const leaves = [...names].filter(
            parent =>
                ![...names].some(
                    child =>
                        child !== parent && references(catalog.get(child)).some(ref => ref.target === parent),
                ),
        );
        if (!leaves.length) {
            block('DEPENDENCY_CYCLE', [...names].join(','));
            break;
        }
        for (const leaf of leaves.sort()) {
            names.delete(leaf);
            deleteOrder.push(leaf);
        }
    }
    const plan = {
        version: 1,
        targets: TARGETS,
        channelId: '5',
        instance: graph.instance,
        graphHash: digest(graph),
        deletes,
        patches,
        deleteOrder,
        blockers,
        deletionCounts: Object.fromEntries(deleteOrder.map(name => [name, graph.rows[name].length])),
    };
    return { ...plan, planHash: digest(plan) };
}
function publicPlan(plan) {
    return {
        version: 1,
        targets: TARGETS,
        channelId: '5',
        planHash: plan.planHash,
        instance: plan.instance,
        deletionCounts: plan.deletionCounts,
        detachedCounts: Object.fromEntries(
            [...RETAINED]
                .filter(name => plan.patches.some(patch => patch.table === name))
                .map(name => [name, plan.patches.filter(patch => patch.table === name).length]),
        ),
        blockers: plan.blockers,
        canApply: plan.blockers.length === 0,
    };
}

async function execute(connection, mode, expectedHash = '') {
    assert.ok(['plan', 'apply'].includes(mode));
    if (mode === 'apply') assert.match(expectedHash, /^[a-f0-9]{64}$/u);
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    try {
        const graph = await collectGraph(connection, mode === 'apply');
        const plan = buildPlan(graph);
        if (mode === 'plan') {
            await connection.rollback();
            return publicPlan(plan);
        }
        assert.equal(plan.planHash, expectedHash, 'CLEANUP_PLAN_CHANGED');
        assert.equal(plan.blockers.length, 0, 'CLEANUP_GRAPH_BLOCKED');
        for (const patch of plan.patches) {
            const columns = Object.keys(patch.changes),
                keys = Object.keys(patch.identity);
            const [result] = await connection.execute(
                `UPDATE ${quote(patch.table)} SET ${columns.map(column => `${quote(column)} = ?`).join(',')} WHERE ${keys.map(column => `${quote(column)} = ?`).join(' AND ')}`,
                [...Object.values(patch.changes), ...Object.values(patch.identity)],
            );
            assert.equal(result.affectedRows, 1, 'BASELINE_ROW_CHANGED');
        }
        for (const name of plan.deleteOrder)
            for (const item of plan.deletes.filter(entry => entry.table === name)) {
                const [result] = await connection.execute(
                    `DELETE FROM ${quote(name)} WHERE ${Object.keys(item.identity)
                        .map(column => `${quote(column)} = ?`)
                        .join(' AND ')}`,
                    Object.values(item.identity),
                );
                assert.equal(result.affectedRows, 1, 'DELETE_ROW_CHANGED');
            }
        const remaining = await queryRows(
            connection,
            'SELECT id FROM `order` WHERE id IN (?,?,?,?) OR code IN (?,?,?,?)',
            [...TARGETS.map(target => target.id), ...TARGETS.map(target => target.code)],
        );
        assert.equal(remaining.length, 0, 'TARGET_ORDERS_REMAIN');
        await connection.commit();
        return {
            ...publicPlan(plan),
            status: 'APPLIED',
            remainingOrders: 0,
            realPaymentActions: 0,
            deliveryActions: 0,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

function runOperation(
    request,
    {
        inspect,
        health,
        spawn,
        backup,
        assertHealth,
        script = path.join(__dirname, 'window-test-order-cleanup.cjs'),
    },
) {
    const apply = request.operation === 'apply-window-test-order-cleanup-reviewed';
    assert.ok(apply || request.operation === 'plan-window-test-order-cleanup');
    const before = inspect();
    assert.equal(before.markerSha, request.expectedRuntimeSha, 'Production runtime SHA changed');
    const healthBefore = health();
    assertHealth(healthBefore, 'before');
    const run = (mode, hash = '') => {
        const result = spawn(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                script,
                mode,
                ...(hash ? [hash] : []),
            ],
            {
                encoding: 'utf8',
                timeout: 120000,
                maxBuffer: 16384,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
            },
        );
        const failureCode =
            /^WINDOW_TEST_ORDER_CLEANUP_FAILED code=([A-Z_]+(?::[A-Za-z0-9_]+)?)\n$/u.exec(
                result.stderr || '',
            )?.[1] || 'OPERATION_FAILED';
        assert.equal(
            result.status,
            0,
            `The fixed test-order cleanup failed code=${failureCode}; no automatic retry`,
        );
        const value = JSON.parse(result.stdout);
        assert.match(value.planHash || '', /^[a-f0-9]{64}$/u);
        assert.match(value.instance || '', /^[a-f0-9]{64}$/u);
        assert.deepEqual(value.targets, [
            { id: '22', code: 'YFRETX1XZJ9D19N7' },
            { id: '47', code: 'QW6DDTSAQE2RZYNC' },
            { id: '48', code: 'JASP65WDHHU3H2AP' },
            { id: '49', code: 'Y5DBD95AC2VYVF34' },
        ]);
        assert.equal(value.channelId, '5');
        assert.equal(typeof value.canApply, 'boolean');
        assert.ok(Array.isArray(value.blockers));
        // Construct a public receipt instead of forwarding arbitrary child output.
        return {
            version: 1,
            targets: value.targets,
            channelId: '5',
            planHash: value.planHash,
            instance: value.instance,
            deletionCounts: value.deletionCounts,
            detachedCounts: value.detachedCounts,
            blockers: value.blockers,
            canApply: value.canApply,
            ...(mode === 'apply'
                ? {
                      status: value.status,
                      remainingOrders: value.remainingOrders,
                      realPaymentActions: value.realPaymentActions,
                      deliveryActions: value.deliveryActions,
                  }
                : {}),
        };
    };
    const plan = run('plan');
    let backupEvidence = null;
    let receipt = null;
    if (apply) {
        assert.equal(plan.planHash, request.expectedPlanSha256, 'Reviewed test-order plan changed');
        assert.equal(plan.canApply, true, 'Test-order graph has unresolved blockers');
        assert.equal(plan.blockers.length, 0);
        backupEvidence = backup();
        receipt = run('apply', request.expectedPlanSha256);
        assert.equal(receipt.status, 'APPLIED');
        assert.equal(receipt.remainingOrders, 0);
        assert.equal(receipt.realPaymentActions, 0);
        assert.equal(receipt.deliveryActions, 0);
    }
    assert.deepEqual(inspect(), before, 'Production runtime changed during test-order cleanup');
    const healthAfter = health();
    assertHealth(healthAfter, 'after');
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        plan,
        ...(backupEvidence ? { backup: backupEvidence, receipt } : {}),
        applied: Boolean(receipt),
        healthBefore,
        healthAfter,
    };
}

async function main() {
    const [mode, expectedHash = ''] = process.argv.slice(2);
    const moduleRoot = process.env.STORE_ISOLATION_MODULE_ROOT;
    assert.ok(moduleRoot && path.isAbsolute(moduleRoot), 'VERIFIED_RUNTIME_REQUIRED');
    const runtime = createRequire(path.join(moduleRoot, 'package.json'));
    const mysql = runtime('mysql2/promise');
    for (const name of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'])
        assert.ok(Object.hasOwn(process.env, name), 'EXPLICIT_DATABASE_CONFIGURATION_REQUIRED');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: false,
        timezone: 'Z',
        dateStrings: true,
    });
    try {
        process.stdout.write(JSON.stringify(await execute(connection, mode, expectedHash)) + '\n');
    } finally {
        await connection.end();
    }
}
if (require.main === module)
    main().catch(error => {
        // Never forward SQL, connection options, row contents, or driver errors.
        process.stderr.write(
            `WINDOW_TEST_ORDER_CLEANUP_FAILED code=${/^[A-Z_]+(?::[A-Za-z0-9_]+)?$/u.test(error.message) ? error.message : 'OPERATION_FAILED'}\n`,
        );
        process.exitCode = 1;
    });
module.exports = { TARGETS, collectGraph, buildPlan, publicPlan, execute, runOperation };
