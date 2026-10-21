import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { classifyChanges } from '../scripts/ci-impact.mjs';

const require = createRequire(import.meta.url);
const operations = require('./production-operations.cjs');
const cleanup = require('./window-test-order-cleanup.cjs');
const runtimeSha = 'b'.repeat(40);
const sourceSha = 'a'.repeat(40);
function graph(extra = {}) {
    const rows = {
        order: cleanup.TARGETS.map(target => ({ ...target, salesChannelId: 5, currencyCode: 'CNY' })),
        payment: [
            {
                id: 16,
                orderId: 49,
                method: 'controlled-test-payment-platform',
                metadata: JSON.stringify({ public: { testPayment: true } }),
            },
        ],
        session: [{ id: 8, activeOrderId: 22 }],
        ...extra,
    };
    const tables = Object.entries(rows).map(([name, entries]) => ({
        name,
        columns: [...new Set(entries.flatMap(Object.keys))],
        primaryKeys: ['id'],
        foreignKeys: [],
    }));
    return { instance: 'c'.repeat(64), tables, rows };
}
test('fixed cleanup requires runtime pin and explicit digest only for apply; no website release', () => {
    const base = { OPS_SOURCE_SHA: sourceSha, OPS_EXPECTED_RUNTIME_SHA: runtimeSha };
    for (const operation of ['plan-window-test-order-cleanup', 'apply-window-test-order-cleanup-reviewed']) {
        const value = {
            ...base,
            OPS_OPERATION: operation,
            ...(operation.startsWith('apply') ? { OPS_EXPECTED_PLAN_SHA256: 'c'.repeat(64) } : {}),
        };
        assert.equal(operations.validateRequest(value).operation, operation);
        assert.throws(
            () => operations.validateRequest({ ...value, OPS_EXPECTED_RUNTIME_SHA: '' }),
            /runtime SHA/u,
        );
    }
    assert.throws(
        () =>
            operations.validateRequest({
                ...base,
                OPS_OPERATION: 'apply-window-test-order-cleanup-reviewed',
            }),
        /plan SHA/u,
    );
    const scope = classifyChanges([
        'deploy/window-test-order-cleanup.cjs',
        '.github/workflows/production_operations.yml',
    ]);
    assert.equal(scope.lane, 'none');
    assert.equal(scope.controls, true);
    assert.deepEqual(scope.packages, []);
    assert.deepEqual(scope.frontends, []);
});
test('unknown relations, real payments, fulfillment and inventory effects stop deletion', () => {
    assert.equal(cleanup.publicPlan(cleanup.buildPlan(graph())).canApply, true);
    for (const [name, row, code] of [
        ['unknown_order_child', { id: 2, orderId: 22 }, 'UNMAPPED_RELATION'],
        ['payment', { id: 3, orderId: 22, method: 'real-provider', metadata: '{}' }, 'NON_SIMULATED_PAYMENT'],
        ['fulfillment', { id: 4 }, 'DELIVERY_OR_REFUND_REQUIRES_SEPARATE_REVIEW'],
        [
            'stock_movement',
            { id: 5, productVariantId: 8, stockLocationId: 1, type: 'ALLOCATION', quantity: 1 },
            'NONZERO_STOCK_BASELINE',
        ],
        [
            'digital_order_reservation',
            { id: 6, stockPolicy: 'limited', quantity: 1, releasedQuantity: 0 },
            'DIGITAL_QUOTA_STILL_RESERVED',
        ],
    ]) {
        const plan = cleanup.buildPlan(graph({ [name]: [row] }));
        assert.ok(
            plan.blockers.some(block => block.code === code),
            code,
        );
        assert.equal(cleanup.publicPlan(plan).canApply, false);
    }
    const privateGraph = graph();
    privateGraph.rows.session[0].fixturePrivateField = 'fixture-private-value';
    assert.ok(
        !JSON.stringify(cleanup.publicPlan(cleanup.buildPlan(privateGraph))).includes(
            'fixture-private-value',
        ),
    );
});

test('retains original governance audit rows while deleting the matching disposable order graph', () => {
    const auditRows = [
        {
            id: 81,
            channelId: 5,
            sequence: 23,
            resourceType: 'Order',
            resourceId: '22',
            eventType: 'FRAUD_EVALUATION_ALLOWED',
            entryHash: 'original-first-hash',
        },
        {
            id: 82,
            channelId: 5,
            sequence: 24,
            resourceType: 'FraudRiskCase',
            resourceId: '7',
            eventType: 'FRAUD_CASE_CREATED',
            previousHash: 'original-first-hash',
            entryHash: 'original-next-hash',
        },
    ];
    const original = structuredClone(auditRows);
    const plan = cleanup.buildPlan(
        graph({ governance_audit_entry: auditRows, fraud_risk_case: [{ id: 7, orderId: 22 }] }),
    );
    assert.equal(cleanup.publicPlan(plan).canApply, true);
    assert.equal(plan.deletes.filter(row => row.table === 'order').length, 4);
    assert.equal(plan.deletes.filter(row => row.table === 'fraud_risk_case').length, 1);
    assert.equal(
        plan.deletes.some(row => row.table === 'governance_audit_entry'),
        false,
    );
    assert.equal(
        plan.patches.some(row => row.table === 'governance_audit_entry'),
        false,
    );
    assert.deepEqual(auditRows, original);
});
test('production wrapper rejects drift and blockers before backup, and only forwards a safe receipt', () => {
    const request = operations.validateRequest({
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        OPS_OPERATION: 'apply-window-test-order-cleanup-reviewed',
        OPS_EXPECTED_PLAN_SHA256: 'c'.repeat(64),
    });
    const plan = {
        ...cleanup.publicPlan(cleanup.buildPlan(graph())),
        planHash: 'c'.repeat(64),
        secret: 'fixture-private-value',
    };
    let calls = 0;
    let backups = 0;
    const deps = {
        inspect: () => ({ markerSha: runtimeSha, currentRuntime: '/verified/runtime' }),
        health: () => ({ status: 'ok', output: 'Result=success\nExecMainStatus=0\nActiveState=inactive\n' }),
        spawn: (_command, args) => {
            calls++;
            return {
                status: 0,
                stdout: JSON.stringify({
                    ...plan,
                    ...(args.includes('apply')
                        ? { status: 'APPLIED', remainingOrders: 0, realPaymentActions: 0, deliveryActions: 0 }
                        : {}),
                }),
            };
        },
        backup: () => {
            backups++;
            return { offsite: true };
        },
    };
    assert.throws(
        () =>
            operations.runWindowTestOrderCleanup(request, {
                ...deps,
                spawn: () => ({ status: 0, stdout: JSON.stringify({ ...plan, planHash: 'd'.repeat(64) }) }),
            }),
        /plan changed/u,
    );
    assert.equal(backups, 0);
    assert.throws(
        () =>
            operations.runWindowTestOrderCleanup(request, {
                ...deps,
                spawn: () => ({
                    status: 0,
                    stdout: JSON.stringify({
                        ...plan,
                        canApply: false,
                        blockers: [{ code: 'UNMAPPED_RELATION', table: 'unknown_child' }],
                    }),
                }),
            }),
        /unresolved blockers/u,
    );
    assert.equal(backups, 0);
    const result = operations.runWindowTestOrderCleanup(request, deps);
    assert.equal(result.applied, true);
    assert.equal(result.receipt.remainingOrders, 0);
    assert.equal(calls, 2);
    assert.equal(backups, 1);
    assert.ok(!JSON.stringify(result).includes('fixture-private-value'));
});

test(
    'native MySQL commits only four exact orders and their graph; mismatch and mid-delete failure roll back',
    { skip: !process.env.WINDOW_TEST_MYSQL_CONTAINER },
    async () => {
        const container = process.env.WINDOW_TEST_MYSQL_CONTAINER;
        const database = 'window_cleanup_' + randomBytes(5).toString('hex');
        const user = database;
        const password = randomBytes(24).toString('hex');
        const rootSql = sql =>
            execFileSync(
                'docker',
                ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'],
                { input: sql, stdio: ['pipe', 'pipe', 'pipe'] },
            );
        rootSql(
            `CREATE DATABASE ${database}; CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON ${database}.* TO '${user}'@'%';`,
        );
        const ports = JSON.parse(
            execFileSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], {
                encoding: 'utf8',
            }),
        );
        const connection = await mysql.createConnection({
            host: '127.0.0.1',
            port: Number(ports['3306/tcp'][0].HostPort),
            user,
            password,
            database,
            timezone: 'Z',
            dateStrings: true,
        });
        try {
            for (const sql of [
                'CREATE TABLE `order` (id int PRIMARY KEY, code varchar(50), salesChannelId int, currencyCode varchar(4))',
                'CREATE TABLE order_line (id int PRIMARY KEY, orderId int, FOREIGN KEY (orderId) REFERENCES `order`(id))',
                'CREATE TABLE payment (id int PRIMARY KEY, orderId int, method varchar(100), metadata json, FOREIGN KEY (orderId) REFERENCES `order`(id))',
                'CREATE TABLE session (id int PRIMARY KEY, activeOrderId int, secretToken varchar(100), FOREIGN KEY (activeOrderId) REFERENCES `order`(id))',
                'CREATE TABLE history_entry (id int PRIMARY KEY, orderId int, FOREIGN KEY (orderId) REFERENCES `order`(id))',
                'CREATE TABLE fraud_risk_case (id int PRIMARY KEY, orderId int)',
                'CREATE TABLE fraud_risk_case_event (id int PRIMARY KEY, riskCaseId int, FOREIGN KEY (riskCaseId) REFERENCES fraud_risk_case(id))',
                'CREATE TABLE storefront_payment_attempt (id int PRIMARY KEY, orderId int)',
                'CREATE TABLE admin_notification_outbox (id int PRIMARY KEY, payload json)',
                'CREATE TABLE admin_incident_evidence (id int PRIMARY KEY, incidentId int, FOREIGN KEY (incidentId) REFERENCES admin_notification_outbox(id))',
                'CREATE TABLE admin_incident_action (id int PRIMARY KEY, incidentId int, FOREIGN KEY (incidentId) REFERENCES admin_notification_outbox(id))',
            ])
                await connection.query(sql);
            for (const target of cleanup.TARGETS)
                await connection.execute("INSERT INTO `order` VALUES (?,?,5,'CNY')", [
                    target.id,
                    target.code,
                ]);
            await connection.query("INSERT INTO `order` VALUES (99,'REAL_ORDER_KEEP',8,'MYR')");
            await connection.query('INSERT INTO order_line VALUES (1,22),(2,49),(3,99)');
            await connection.execute('INSERT INTO payment VALUES (16,49,?,?)', [
                'controlled-test-payment-platform',
                JSON.stringify({ public: { testPayment: true } }),
            ]);
            await connection.query(
                "INSERT INTO session VALUES (1,22,'keep-authentication'),(2,99,'keep-other-authentication')",
            );
            await connection.query('INSERT INTO history_entry VALUES (1,22),(2,49),(3,99)');
            await connection.query('INSERT INTO fraud_risk_case VALUES (1,47),(2,48),(3,49),(4,99)');
            await connection.query('INSERT INTO fraud_risk_case_event VALUES (1,1),(2,3),(3,4)');
            await connection.query('INSERT INTO storefront_payment_attempt VALUES (1,22),(2,99)');
            await connection.execute('INSERT INTO admin_notification_outbox VALUES (1,?),(2,?)', [
                JSON.stringify({ orderId: 49 }),
                JSON.stringify({ orderId: 99 }),
            ]);
            await connection.query('INSERT INTO admin_incident_evidence VALUES (1,1),(2,2)');
            await connection.query('INSERT INTO admin_incident_action VALUES (1,1),(2,2)');
            const plan = await cleanup.execute(connection, 'plan');
            assert.equal(plan.canApply, true);
            assert.equal(plan.deletionCounts.order, 4);
            assert.equal(plan.deletionCounts.fraud_risk_case_event, 2);
            assert.equal(plan.deletionCounts.admin_incident_evidence, 1);
            assert.equal(plan.deletionCounts.admin_incident_action, 1);
            await assert.rejects(cleanup.execute(connection, 'apply', 'd'.repeat(64)), /PLAN_CHANGED/u);
            let [rows] = await connection.query('SELECT COUNT(*) AS count FROM `order`');
            assert.equal(rows[0].count, 5);
            const originalExecute = connection.execute.bind(connection);
            connection.execute = (sql, values) =>
                sql.startsWith('DELETE FROM `order`')
                    ? Promise.reject(new Error('FIXTURE_DELETE_FAILURE'))
                    : originalExecute(sql, values);
            await assert.rejects(
                cleanup.execute(connection, 'apply', plan.planHash),
                /FIXTURE_DELETE_FAILURE/u,
            );
            [rows] = await connection.query('SELECT activeOrderId FROM session WHERE id=1');
            assert.equal(rows[0].activeOrderId, 22);
            [rows] = await connection.query('SELECT COUNT(*) AS count FROM payment');
            assert.equal(rows[0].count, 1);
            connection.execute = originalExecute;
            const applied = await cleanup.execute(connection, 'apply', plan.planHash);
            assert.equal(applied.status, 'APPLIED');
            assert.equal(applied.remainingOrders, 0);
            [rows] = await connection.query('SELECT id FROM `order`');
            assert.deepEqual(
                rows.map(row => row.id),
                [99],
            );
            [rows] = await connection.query('SELECT * FROM session ORDER BY id');
            assert.equal(rows[0].activeOrderId, null);
            assert.equal(rows[0].secretToken, 'keep-authentication');
            assert.equal(rows[1].activeOrderId, 99);
            [rows] = await connection.query('SELECT orderId FROM fraud_risk_case');
            assert.deepEqual(
                rows.map(row => row.orderId),
                [99],
            );
            [rows] = await connection.query('SELECT incidentId FROM admin_incident_evidence');
            assert.deepEqual(
                rows.map(row => row.incidentId),
                [2],
            );
            [rows] = await connection.query('SELECT incidentId FROM admin_incident_action');
            assert.deepEqual(
                rows.map(row => row.incidentId),
                [2],
            );
            [rows] = await connection.query('SELECT orderId FROM storefront_payment_attempt');
            assert.deepEqual(
                rows.map(row => row.orderId),
                [99],
            );
        } finally {
            await connection.end();
            rootSql(`DROP DATABASE ${database}; DROP USER '${user}'@'%';`);
        }
    },
);
