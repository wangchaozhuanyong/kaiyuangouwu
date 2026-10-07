import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    createReadOnlyMysqlAdapter,
    createStoreIsolationAdapter,
    safeReadOnlyAuditFailure,
} from './store-isolation-data-preflight.mjs';

// This audit only SELECTs within the adapter's read-only snapshot. It never applies compensation.
const tables = {
    store_profile: ['id', 'channelId', 'status', 'isPublished', 'updatedAt'],
    store_domain: ['channelId', 'domain', 'isPrimary', 'status'],
    order: ['id', 'salesChannelId', 'state', 'updatedAt'],
    payment: ['id', 'orderId', 'method', 'state', 'metadata'],
    checkout_resource_hold: ['id', 'orderId', 'channelId', 'state', 'updatedAt'],
    coupon_order_allocation: ['id', 'orderId', 'channelId', 'status', 'updatedAt', 'usedAt', 'releasedAt'],
    customer_coupon: [
        'id',
        'usedOrderId',
        'channelId',
        'status',
        'version',
        'updatedAt',
        'validFrom',
        'validUntil',
        'usedAt',
        'lockedOrderId',
        'lockedAt',
        'lockExpiresAt',
        'returnCount',
        'revokedAt',
    ],
    digital_order_reservation: [
        'id',
        'orderId',
        'channelId',
        'state',
        'quantity',
        'releasedQuantity',
        'consumedQuantity',
        'updatedAt',
    ],
    order_line: ['id', 'orderId'],
    stock_movement: ['id', 'orderLineId', 'type', 'quantity', 'updatedAt'],
};

const terminalNoFunds = new Set(['Declined', 'Cancelled']);
const confirmed = new Set(['Settled', 'Authorized']);

function metadata(value) {
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return null;
    }
}

export function classifySimulationPayments(payments) {
    const relevant = payments.filter(payment => !terminalNoFunds.has(payment.state));
    const strictTest = payment =>
        String(payment.method).startsWith('controlled-test-payment-') &&
        metadata(payment.metadata)?.public?.testPayment === true;
    const eligible =
        relevant.length > 0 &&
        relevant.some(payment => payment.state === 'Settled') &&
        relevant.every(payment => confirmed.has(payment.state) && strictTest(payment)) &&
        !payments.some(payment => metadata(payment.metadata)?.manualReview?.required);
    return {
        status: eligible ? 'TEST_ONLY_REVIEWABLE' : 'REQUIRES_PAYMENT_RECONCILIATION',
        payments: payments.map(payment => ({
            id: String(payment.id),
            state: payment.state,
            method: payment.method,
            serverMarkedTest: strictTest(payment),
        })),
    };
}

export async function collectPublicPreviewClosureAudit(adapter) {
    const missing = [];
    for (const [table, columns] of Object.entries(tables)) {
        if (!(await adapter.tableExists(table))) {
            missing.push(table);
            continue;
        }
        for (const column of columns) {
            if (!(await adapter.columnExists(table, column))) missing.push(`${table}.${column}`);
        }
    }
    if (missing.length) {
        return { mode: 'read-only', status: 'UNVERIFIED_SCHEMA', missing, compensation: null };
    }
    const profiles = await adapter.query(
        'SELECT p.id, p.channelId, p.status, p.isPublished, p.updatedAt, d.domain AS primaryDomain ' +
            'FROM store_profile p LEFT JOIN store_domain d ON d.channelId = p.channelId ' +
            "AND d.isPrimary = 1 AND d.status = 'ACTIVE'",
    );
    const transition = profiles
        .filter(profile => ['moyaoai.com', 'damatong.net'].includes(profile.primaryDomain))
        .map(profile => ({
            profileId: String(profile.id),
            channelId: String(profile.channelId),
            primaryDomain: profile.primaryDomain,
            status: profile.status,
            isPublished: Boolean(profile.isPublished),
            expectedUpdatedAt: profile.updatedAt,
            proposedIsPublished: true,
            eligible: profile.status === 'DRAFT' && !profile.isPublished,
        }));
    const candidates = await adapter.query(
        'SELECT DISTINCT o.id, o.salesChannelId, o.state, o.updatedAt FROM `order` o ' +
            'INNER JOIN payment p ON p.orderId = o.id WHERE p.method LIKE ?',
        ['controlled-test-payment-%'],
    );
    const compensation = [];
    for (const order of candidates) {
        const payments = await adapter.query(
            'SELECT id, method, state, metadata FROM payment WHERE orderId = ?',
            [order.id],
        );
        // Do not include ordinary real orders in the exported list.
        if (
            !payments.some(
                payment =>
                    String(payment.method).startsWith('controlled-test-payment-') ||
                    metadata(payment.metadata)?.public?.testPayment === true,
            )
        )
            continue;
        const evidence = classifySimulationPayments(payments);
        const holds = await adapter.query(
            "SELECT id, channelId, state, updatedAt FROM checkout_resource_hold WHERE orderId = ? AND state <> 'RELEASED'",
            [order.id],
        );
        const allocations = await adapter.query(
            "SELECT id, channelId, status, usedAt, releasedAt, updatedAt FROM coupon_order_allocation WHERE orderId = ? AND status = 'USED'",
            [order.id],
        );
        const coupons = await adapter.query(
            'SELECT id, channelId, status, version, updatedAt, validFrom, validUntil, usedAt, usedOrderId, ' +
                'lockedOrderId, lockedAt, lockExpiresAt, returnCount, revokedAt ' +
                "FROM customer_coupon WHERE usedOrderId = ? AND status = 'USED'",
            [order.id],
        );
        const digitalReservations = await adapter.query(
            'SELECT id, channelId, state, quantity, releasedQuantity, consumedQuantity, updatedAt ' +
                "FROM digital_order_reservation WHERE orderId = ? AND state = 'HELD' " +
                'AND quantity > releasedQuantity + consumedQuantity',
            [order.id],
        );
        const physicalAllocations = await adapter.query(
            'SELECT l.id AS orderLineId, SUM(CASE ' +
                "WHEN m.type = 'ALLOCATION' THEN m.quantity WHEN m.type = 'RELEASE' THEN -m.quantity " +
                "WHEN m.type = 'SALE' THEN -ABS(m.quantity) ELSE 0 END) AS outstandingQuantity " +
                'FROM order_line l INNER JOIN stock_movement m ON m.orderLineId = l.id ' +
                'WHERE l.orderId = ? GROUP BY l.id HAVING outstandingQuantity > 0',
            [order.id],
        );
        const stockMovements = physicalAllocations.length
            ? await adapter.query(
                  'SELECT m.id, m.orderLineId, m.type, m.quantity, m.updatedAt FROM stock_movement m ' +
                      'INNER JOIN order_line l ON l.id = m.orderLineId WHERE l.orderId = ?',
                  [order.id],
              )
            : [];
        const resources = [...holds, ...allocations, ...coupons, ...digitalReservations];
        if (!resources.length && !physicalAllocations.length) continue;
        const matchingOwnership =
            order.salesChannelId != null &&
            resources.every(row => String(row.channelId) === String(order.salesChannelId));
        compensation.push({
            orderId: String(order.id),
            salesChannelId: order.salesChannelId == null ? null : String(order.salesChannelId),
            orderState: order.state,
            orderUpdatedAt: order.updatedAt,
            ...evidence,
            status: matchingOwnership ? evidence.status : 'REQUIRES_OWNERSHIP_RECONCILIATION',
            original: {
                holds,
                allocations,
                coupons,
                digitalReservations,
                physicalAllocations,
                stockMovements,
            },
            proposedAction:
                'Review evidence and release through domain services after separate production authorization',
        });
    }
    return {
        mode: 'read-only',
        status: 'SNAPSHOT_COMPLETE',
        transition,
        auditedSimulationCandidates: candidates.length,
        compensation,
    };
}

async function main() {
    const databaseType = String(process.env.DB ?? 'mysql').toLowerCase();
    let adapter;
    if (['mysql', 'mariadb'].includes(databaseType)) {
        const require = process.env.STORE_ISOLATION_MODULE_ROOT
            ? createRequire(path.join(process.env.STORE_ISOLATION_MODULE_ROOT, 'package.json'))
            : createRequire(import.meta.url);
        const mysql = require('mysql2/promise');
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USERNAME || 'vendure',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'vendure-dev',
            timezone: 'Z',
            multipleStatements: false,
        });
        adapter = await createReadOnlyMysqlAdapter(connection);
    } else {
        adapter = await createStoreIsolationAdapter(process.env);
    }
    try {
        process.stdout.write(JSON.stringify(await collectPublicPreviewClosureAudit(adapter), null, 2) + '\n');
    } finally {
        await adapter.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await main();
    } catch (error) {
        process.stderr.write(safeReadOnlyAuditFailure(error) + '\n');
        process.exitCode = 1;
    }
}
