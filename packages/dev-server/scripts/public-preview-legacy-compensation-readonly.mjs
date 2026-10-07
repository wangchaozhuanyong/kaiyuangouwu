import assert from 'node:assert/strict';

import {
    compensationFingerprint,
    LEGACY_COMPENSATION_LINE_RISK_TABLES,
    LEGACY_COMPENSATION_RISK_TABLES,
    LEGACY_COMPENSATION_SCOPE,
} from './public-preview-legacy-compensation.mjs';

const schema = {
    order: ['id', 'salesChannelId', 'state', 'updatedAt'],
    payment: ['id', 'orderId', 'method', 'state', 'amount', 'updatedAt', 'metadata'],
    refund: ['id', 'paymentId', 'state', 'updatedAt'],
    order_line: ['id', 'orderId', 'productVariantId', 'quantity', 'updatedAt'],
    product_variant: ['id', 'productId', 'updatedAt'],
    product: ['id', 'updatedAt'],
    stock_movement: [
        'id',
        'orderLineId',
        'productVariantId',
        'stockLocationId',
        'type',
        'quantity',
        'updatedAt',
    ],
    stock_level: ['id', 'productVariantId', 'stockLocationId', 'stockOnHand', 'stockAllocated', 'updatedAt'],
    stock_location: ['id', 'updatedAt'],
    stock_location_channels_channel: ['stockLocationId', 'channelId'],
    storefront_cart: ['id', 'channelId', 'checkoutOrderId', 'revision', 'projectedRevision', 'state'],
    order_fulfillments_fulfillment: ['orderId', 'fulfillmentId'],
    customer_coupon: [
        'id',
        'channelId',
        'version',
        'status',
        'validFrom',
        'validUntil',
        'usedOrderId',
        'usedAt',
        'lockedOrderId',
        'lockedAt',
        'lockExpiresAt',
        'expiredAt',
        'returnedAt',
        'revokedAt',
        'returnCount',
        'updatedAt',
    ],
    coupon_order_allocation: [
        'id',
        'channelId',
        'orderId',
        'customerCouponId',
        'status',
        'usedAt',
        'releasedAt',
        'refundId',
        'refundedAmount',
        'refundedAt',
        'updatedAt',
    ],
    coupon_ledger_entry: [
        'id',
        'channelId',
        'customerCouponId',
        'orderId',
        'eventType',
        'idempotencyKey',
        'createdAt',
        'updatedAt',
    ],
};

/** SELECT-only evidence collector for an adapter already inside a consistent read-only snapshot. */
export async function collectLegacyCompensationReadOnlyEvidence(adapter, clock = () => new Date()) {
    const required = { ...schema };
    for (const [tables, ownershipColumn] of [
        [LEGACY_COMPENSATION_RISK_TABLES, 'orderId'],
        [LEGACY_COMPENSATION_LINE_RISK_TABLES, 'orderLineId'],
    ]) {
        for (const table of tables)
            required[table] = [...new Set([...(required[table] ?? []), 'id', ownershipColumn])];
    }
    const missing = [];
    for (const [table, columns] of Object.entries(required)) {
        if (!(await adapter.tableExists(table))) {
            missing.push(table);
            continue;
        }
        for (const column of columns)
            if (!(await adapter.columnExists(table, column))) missing.push(`${table}.${column}`);
    }
    if (missing.length)
        return { mode: 'read-only', status: 'UNVERIFIED_SCHEMA', missing, productionWriteAllowed: false };
    const select = async (table, columns, where, parameters) => {
        assert.ok(Object.hasOwn(required, table), 'Unreviewed evidence table');
        assert.ok(
            columns.every(column => required[table].includes(column)),
            'Unreviewed evidence column',
        );
        return adapter.query(
            `SELECT ${columns.map(column => '`' + column + '`').join(', ')} FROM \`${table}\` WHERE ${where}`,
            parameters,
        );
    };
    const orders = [];
    for (const [orderId, scope] of Object.entries(LEGACY_COMPENSATION_SCOPE)) {
        const order = await select('order', schema.order, 'id = ?', [orderId]);
        assert.equal(order.length, 1, 'Named original order is missing');
        assert.equal(String(order[0].salesChannelId), scope.channelId, 'Immutable sales Channel changed');
        const payments = await select('payment', schema.payment, 'orderId = ?', [orderId]);
        const paymentEvidence = payments.map(payment => {
            let metadata;
            try {
                metadata =
                    typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
            } catch {
                metadata = null;
            }
            const { metadata: _metadata, ...record } = payment;
            return {
                ...record,
                serverMarkedTest: metadata?.public?.testPayment === true,
                manualReviewRequired: Boolean(metadata?.manualReview?.required),
                metadataFingerprint: compensationFingerprint(payment.metadata ?? null),
            };
        });
        const refunds = [];
        for (const payment of payments)
            refunds.push(...(await select('refund', schema.refund, 'paymentId = ?', [payment.id])));
        const lines = await select('order_line', schema.order_line, 'orderId = ?', [orderId]);
        const movements = [];
        const lineRisks = Object.fromEntries(LEGACY_COMPENSATION_LINE_RISK_TABLES.map(table => [table, []]));
        for (const line of lines) {
            movements.push(
                ...(await select('stock_movement', schema.stock_movement, 'orderLineId = ?', [line.id])),
            );
            for (const table of LEGACY_COMPENSATION_LINE_RISK_TABLES)
                lineRisks[table].push(
                    ...(await select(table, required[table], 'orderLineId = ?', [line.id])),
                );
        }
        const stockLevels = [];
        const locations = [];
        for (const pair of [
            ...new Set(movements.map(row => `${row.productVariantId}:${row.stockLocationId}`)),
        ].sort()) {
            const [variantId, locationId] = pair.split(':');
            stockLevels.push(
                ...(await select(
                    'stock_level',
                    schema.stock_level,
                    'productVariantId = ? AND stockLocationId = ?',
                    [variantId, locationId],
                )),
            );
        }
        for (const locationId of [...new Set(movements.map(row => String(row.stockLocationId)))].sort()) {
            const rows = await select('stock_location', schema.stock_location, 'id = ?', [locationId]);
            const channels = await select(
                'stock_location_channels_channel',
                schema.stock_location_channels_channel,
                'stockLocationId = ?',
                [locationId],
            );
            assert.equal(rows.length, 1, 'Original stock location missing');
            locations.push({
                ...rows[0],
                channelIds: channels.map(channel => String(channel.channelId)).sort(),
            });
        }
        const coupons = await select('customer_coupon', schema.customer_coupon, 'usedOrderId = ?', [orderId]);
        const allocations = await select(
            'coupon_order_allocation',
            schema.coupon_order_allocation,
            'orderId = ?',
            [orderId],
        );
        const ledger = [];
        for (const coupon of coupons)
            ledger.push(
                ...(await select('coupon_ledger_entry', schema.coupon_ledger_entry, 'customerCouponId = ?', [
                    coupon.id,
                ])),
            );
        const risks = { ...lineRisks };
        for (const table of LEGACY_COMPENSATION_RISK_TABLES) {
            const orderRows = await select(table, required[table], 'orderId = ?', [orderId]);
            risks[table] = [
                ...new Map(
                    [...(risks[table] ?? []), ...orderRows].map(row => [String(row.id), row]),
                ).values(),
            ];
        }
        orders.push({
            order: order[0],
            payments: paymentEvidence,
            refunds,
            lines,
            movements,
            locations,
            stockLevels,
            carts: await select('storefront_cart', schema.storefront_cart, 'checkoutOrderId = ?', [orderId]),
            fulfillments: await select(
                'order_fulfillments_fulfillment',
                schema.order_fulfillments_fulfillment,
                'orderId = ?',
                [orderId],
            ),
            coupons,
            allocations,
            ledger,
            risks,
        });
    }
    return {
        mode: 'read-only',
        status: 'TARGETED_EVIDENCE_COMPLETE',
        orders,
        capturedAt: clock().toISOString(),
        fingerprint: compensationFingerprint(orders),
        productionWriteAllowed: false,
        executionManifest: false,
        requiredBeforeApply: [
            'Reviewed native provider capture including physical fulfillment identity and full persisted entity fingerprints.',
            'Actual repaired production runtime funding/test-order protections and release/source fingerprint proof.',
            'Per-order fresh capture and read-review-apply: earlier releases can change shared StockLevel fingerprints.',
        ],
    };
}
