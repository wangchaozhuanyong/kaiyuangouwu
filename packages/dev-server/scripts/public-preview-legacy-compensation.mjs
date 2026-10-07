import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Reviewed one-time data compensation, not a storefront rule or a public API.
// No bootstrap, database credentials, CLI production writer, cancellation or refund is created here.
export const LEGACY_COMPENSATION_VERSION = 'public-preview-legacy-compensation-v1';
export const LEGACY_COMPENSATION_AUTHORIZATION = 'ORIGINAL_SIX_20261007';
export const LEGACY_COMPENSATION_SCOPE = Object.freeze({
    25: { channelId: '2', lines: { 187: 1 } },
    28: { channelId: '2', lines: { 188: 4, 217: 1, 218: 3, 219: 1, 220: 1, 221: 1, 222: 1 } },
    29: { channelId: '2', lines: { 223: 1 } },
    34: { channelId: '2', lines: { 235: 4 }, couponIds: ['7'] },
    36: { channelId: '2', lines: { 238: 1 } },
    37: { channelId: '5', lines: { 248: 1 }, couponIds: ['8'] },
});
for (const scope of Object.values(LEGACY_COMPENSATION_SCOPE)) {
    Object.freeze(scope.lines);
    if (scope.couponIds) Object.freeze(scope.couponIds);
    Object.freeze(scope);
}

export const LEGACY_COMPENSATION_RISK_TABLES = Object.freeze([
    'checkout_resource_hold',
    'storefront_usdt_checkout_quote',
    'storefront_usdt_payment_intent',
    'store_usdt_manual_refund',
    'store_usdt_reconciliation_action',
    'referral_balance_use',
    'referral_reward',
    'referral_ledger_entry',
    'fulfillment_delivery_record',
    'physical_return_receipt',
    'after_sales_request',
    'digital_order_reservation',
    'digital_receipt_access',
    'manual_digital_delivery',
    'auto_card_delivery',
    'auto_card_supply_snapshot',
    'packaging_unpack_event',
]);

export const LEGACY_COMPENSATION_LINE_RISK_TABLES = Object.freeze([
    'catalog_inventory_lot_movement',
    'physical_return_receipt',
    'auto_card_supply_snapshot',
]);

const requiredEntities = [
    'Order',
    'OrderLine',
    'Payment',
    'StockMovement',
    'StockLevel',
    'StockLocation',
    'OrderHistoryEntry',
    'CustomerCoupon',
    'CouponOrderAllocation',
    'CouponLedgerEntry',
];
const id = value => (value == null ? null : String(value));
const date = value => (value == null ? null : new Date(value).toISOString());
const sortRows = rows => rows.sort((left, right) => String(left.id).localeCompare(String(right.id)));

export function canonicalCompensationJson(value) {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return '[' + value.map(canonicalCompensationJson).join(',') + ']';
    if (value && typeof value === 'object') {
        return (
            '{' +
            Object.keys(value)
                .filter(key => value[key] !== undefined)
                .sort()
                .map(key => JSON.stringify(key) + ':' + canonicalCompensationJson(value[key]))
                .join(',') +
            '}'
        );
    }
    return JSON.stringify(value);
}

export const compensationFingerprint = value =>
    createHash('sha256').update(canonicalCompensationJson(value)).digest('hex');

const pick = (row, fields) =>
    Object.fromEntries(
        fields.map(field => [
            field,
            field.endsWith('At') || field === 'validFrom' || field === 'validUntil'
                ? date(row[field])
                : field === 'id' || field.endsWith('Id')
                  ? id(row[field])
                  : (row[field] ?? null),
        ]),
    );

// Only a digest of potentially sensitive persisted columns leaves the provider context.
function entityFingerprint(row, metadata) {
    const values = Object.fromEntries(
        metadata.columns.map(column => [column.propertyPath, column.getEntityValue(row) ?? null]),
    );
    return compensationFingerprint(values);
}

export function validateLegacyCompensationSnapshot(snapshot, now = new Date()) {
    const scope = LEGACY_COMPENSATION_SCOPE[snapshot?.order?.id];
    assert.ok(scope, 'Order is outside the original six-order authorization');
    assert.equal(snapshot.order.salesChannelId, scope.channelId, 'Immutable sales Channel mismatch');
    assert.ok(
        ['PaymentSettled', 'Modifying'].includes(snapshot.order.state),
        'Unexpected historical order state',
    );
    assert.ok(snapshot.payments.length > 0, 'Persisted simulation payment is missing');
    assert.ok(
        snapshot.payments.some(payment => payment.state === 'Settled'),
        'Settled test payment missing',
    );
    for (const payment of snapshot.payments) {
        assert.ok(['Settled', 'Authorized'].includes(payment.state), 'Unreconciled payment state');
        assert.equal(
            payment.method,
            `controlled-test-payment-${scope.channelId}`,
            'Native test method mismatch',
        );
        assert.equal(payment.serverMarkedTest, true, 'Persisted server test marker missing');
        assert.equal(payment.manualReviewRequired, false, 'Payment needs manual review');
        assert.deepEqual(payment.refunds, [], 'Existing refund blocks compensation');
    }
    assert.deepEqual(snapshot.fulfillments, [], 'Existing fulfillment blocks compensation');
    for (const table of [...LEGACY_COMPENSATION_RISK_TABLES, ...LEGACY_COMPENSATION_LINE_RISK_TABLES]) {
        assert.ok(Array.isArray(snapshot.risks[table]), `Unverified risk table: ${table}`);
        assert.deepEqual(snapshot.risks[table], [], `Existing ${table} blocks compensation`);
    }
    assert.ok(Array.isArray(snapshot.carts), 'Cart evidence missing');
    assert.ok(
        snapshot.carts.every(cart => cart.channelId === scope.channelId),
        'Foreign Cart ownership',
    );
    assert.ok(snapshot.movements.length > 0, 'Original physical allocation missing');
    assert.ok(
        snapshot.movements.every(row => row.type === 'ALLOCATION'),
        'Prior stock disposition requires review',
    );
    const releases = [];
    for (const line of snapshot.lines) {
        const movements = snapshot.movements.filter(row => row.orderLineId === line.id);
        if (!movements.length) continue;
        assert.equal(line.fulfillmentType, 'physical', 'Digital or unknown order-line fulfillment type');
        assert.ok(Object.hasOwn(scope.lines, line.id), 'Stock line is outside original approved scope');
        assert.ok(
            movements.every(row => row.productVariantId === line.productVariantId),
            'Variant mismatch',
        );
        const locations = new Set(movements.map(row => row.stockLocationId));
        assert.equal(locations.size, 1, 'Multiple original stock locations require separate review');
        const quantity = movements.reduce((sum, row) => sum + Number(row.quantity), 0);
        assert.ok(Number.isSafeInteger(quantity) && quantity > 0, 'Invalid outstanding allocation');
        assert.ok(
            quantity <= scope.lines[line.id] && quantity <= line.quantity,
            'Allocation exceeds approved quantity',
        );
        const stockLocationId = [...locations][0];
        const location = snapshot.locations.find(row => row.id === stockLocationId);
        assert.ok(
            location?.channelIds.includes(scope.channelId),
            'Original stock location is outside sales Channel',
        );
        const level = snapshot.stockLevels.find(
            row => row.stockLocationId === stockLocationId && row.productVariantId === line.productVariantId,
        );
        assert.ok(
            level && level.stockAllocated >= quantity,
            'Original StockLevel allocation is insufficient',
        );
        releases.push({
            orderLineId: line.id,
            productVariantId: line.productVariantId,
            stockLocationId,
            quantity,
        });
    }
    assert.equal(
        releases.length,
        Object.keys(scope.lines).length,
        'Approved physical allocation set changed',
    );
    for (const level of snapshot.stockLevels) {
        const total = releases
            .filter(
                row =>
                    row.productVariantId === level.productVariantId &&
                    row.stockLocationId === level.stockLocationId,
            )
            .reduce((sum, row) => sum + row.quantity, 0);
        assert.ok(level.stockAllocated >= total, 'Aggregate original StockLevel allocation is insufficient');
    }
    assert.deepEqual(
        snapshot.coupons.map(row => row.id).sort(),
        [...(scope.couponIds ?? [])].sort(),
        'Approved coupon set changed',
    );
    for (const coupon of snapshot.coupons) {
        assert.equal(coupon.channelId, scope.channelId, 'Coupon Channel mismatch');
        assert.equal(coupon.status, 'USED', 'Coupon is no longer the original USED entitlement');
        assert.equal(coupon.usedOrderId, snapshot.order.id, 'Coupon usage owner mismatch');
        assert.ok(coupon.validUntil && new Date(coupon.validUntil) <= now, 'Coupon is not expired');
        assert.equal(coupon.revokedAt, null, 'Revoked coupon requires review');
        assert.ok(
            coupon.lockedOrderId == null || coupon.lockedOrderId === snapshot.order.id,
            'Foreign coupon lock',
        );
        const allocations = snapshot.allocations.filter(row => row.customerCouponId === coupon.id);
        assert.equal(allocations.length, 1, 'Coupon allocation is ambiguous');
        const allocation = allocations[0];
        assert.equal(allocation.channelId, scope.channelId, 'Coupon allocation Channel mismatch');
        assert.equal(allocation.orderId, snapshot.order.id, 'Coupon allocation order mismatch');
        assert.equal(allocation.status, 'USED', 'Coupon allocation is no longer USED');
        assert.equal(allocation.refundId, null, 'Coupon refund linkage blocks compensation');
        assert.equal(allocation.refundedAmount, 0, 'Coupon refund amount blocks compensation');
        assert.ok(
            snapshot.ledger.some(
                entry =>
                    entry.customerCouponId === coupon.id &&
                    entry.eventType === 'REDEEMED' &&
                    entry.orderId === snapshot.order.id,
            ),
            'Original coupon redemption ledger missing',
        );
    }
    assert.equal(
        snapshot.allocations.length,
        snapshot.coupons.length,
        'Additional coupon allocations require review',
    );
    return releases;
}

/**
 * Only call with services from a reviewed, managed Vendure injector. This module intentionally
 * cannot open a database or start Nest/worker lifecycle hooks. Only the authorized data writer
 * may call apply in the reviewed execution host; the release controller does not own this write.
 */
export function createLegacyCompensationExecutor({
    connection,
    orders,
    carts,
    stockMovements,
    stockLocations,
    coupons,
    history,
    entities,
    superAdminPermission,
    isolatedTest = false,
    verifyProductionRuntimeProtections,
    clock = () => new Date(),
}) {
    for (const key of requiredEntities) assert.ok(entities?.[key], `Missing managed entity: ${key}`);
    assert.equal(superAdminPermission, 'SuperAdmin', 'Native SuperAdmin permission is required');
    for (const service of [connection, orders, carts, stockMovements, stockLocations, coupons, history]) {
        assert.ok(service, 'Missing managed domain provider');
    }
    const repository = (ctx, key) => connection.getRepository(ctx, entities[key]);
    const entityMeta = key => connection.rawConnection.getMetadata(entities[key]);
    const receiptKey = orderId => `${LEGACY_COMPENSATION_VERSION}:${orderId}`;

    async function capture(ctx, orderId) {
        const scope = LEGACY_COMPENSATION_SCOPE[orderId];
        assert.ok(scope, 'Order is outside the original six-order authorization');
        assert.equal(id(ctx.channelId), scope.channelId, 'Context Channel mismatch');
        const order = await repository(ctx, 'Order').findOne({
            where: { id: orderId },
            relations: { fulfillments: true },
        });
        assert.ok(order, 'Order missing');
        const payments = await repository(ctx, 'Payment').find({
            where: { order: { id: orderId } },
            relations: { refunds: true },
        });
        const lines = await repository(ctx, 'OrderLine').find({
            where: { order: { id: orderId } },
            relations: { productVariant: { product: true } },
        });
        assert.ok(lines.length, 'Order lines missing');
        const movements = await repository(ctx, 'StockMovement')
            .createQueryBuilder('movement')
            .select('movement.id', 'id')
            .addSelect('movement.orderLineId', 'orderLineId')
            .addSelect('movement.productVariantId', 'productVariantId')
            .addSelect('movement.stockLocationId', 'stockLocationId')
            .addSelect('movement.type', 'type')
            .addSelect('movement.quantity', 'quantity')
            .addSelect('movement.updatedAt', 'updatedAt')
            .where('movement.orderLineId IN (:...lineIds)', { lineIds: lines.map(line => line.id) })
            .getRawMany();
        const locations = [];
        const stockLevels = [];
        for (const locationId of [...new Set(movements.map(row => id(row.stockLocationId)))].sort()) {
            const location = await repository(ctx, 'StockLocation').findOne({
                where: { id: locationId },
                relations: { channels: true },
            });
            assert.ok(location, 'Original stock location missing');
            locations.push({
                ...pick(location, ['id', 'updatedAt']),
                channelIds: location.channels.map(channel => id(channel.id)).sort(),
            });
        }
        for (const pair of [
            ...new Set(movements.map(row => `${row.productVariantId}:${row.stockLocationId}`)),
        ].sort()) {
            const [productVariantId, stockLocationId] = pair.split(':');
            const level = await repository(ctx, 'StockLevel').findOne({
                where: { productVariantId, stockLocationId },
            });
            assert.ok(level, 'Original StockLevel missing');
            stockLevels.push(
                pick(level, [
                    'id',
                    'productVariantId',
                    'stockLocationId',
                    'stockOnHand',
                    'stockAllocated',
                    'updatedAt',
                ]),
            );
        }
        const couponRows = await repository(ctx, 'CustomerCoupon').find({ where: { usedOrderId: orderId } });
        const allocationRows = await repository(ctx, 'CouponOrderAllocation').find({ where: { orderId } });
        const ledger = [];
        for (const coupon of couponRows) {
            const entries = await repository(ctx, 'CouponLedgerEntry').find({
                where: { customerCouponId: coupon.id },
            });
            ledger.push(
                ...entries.map(entry => ({
                    ...pick(entry, [
                        'id',
                        'channelId',
                        'customerCouponId',
                        'orderId',
                        'eventType',
                        'idempotencyKey',
                        'updatedAt',
                    ]),
                    fingerprint: entityFingerprint(entry, entityMeta('CouponLedgerEntry')),
                })),
            );
        }
        const risks = {};
        for (const table of LEGACY_COMPENSATION_RISK_TABLES) {
            const metadata = connection.rawConnection.getMetadata(table);
            assert.ok(metadata.findColumnWithPropertyName('orderId'), `Unverified risk table: ${table}`);
            const rows = await connection.getRepository(ctx, metadata.target).find({ where: { orderId } });
            risks[table] = sortRows(
                rows.map(row => ({ id: id(row.id), fingerprint: entityFingerprint(row, metadata) })),
            );
        }
        for (const table of LEGACY_COMPENSATION_LINE_RISK_TABLES) {
            const metadata = connection.rawConnection.getMetadata(table);
            assert.ok(metadata.findColumnWithPropertyName('orderLineId'), `Unverified risk table: ${table}`);
            const rows = [];
            for (const line of lines)
                rows.push(
                    ...(await connection
                        .getRepository(ctx, metadata.target)
                        .find({ where: { orderLineId: line.id } })),
                );
            risks[table] = sortRows([
                ...new Map(
                    [
                        ...(risks[table] ?? []),
                        ...rows.map(row => ({
                            id: id(row.id),
                            fingerprint: entityFingerprint(row, metadata),
                        })),
                    ].map(row => [row.id, row]),
                ).values(),
            ]);
        }
        const cartMetadata = connection.rawConnection.getMetadata('storefront_cart');
        const cartRows = await connection
            .getRepository(ctx, cartMetadata.target)
            .find({ where: { checkoutOrderId: orderId } });
        const snapshot = {
            order: {
                ...pick(order, ['id', 'salesChannelId', 'state', 'updatedAt']),
                fingerprint: entityFingerprint(order, entityMeta('Order')),
            },
            payments: sortRows(
                payments.map(payment => ({
                    ...pick(payment, ['id', 'method', 'state', 'amount', 'updatedAt']),
                    serverMarkedTest: payment.metadata?.public?.testPayment === true,
                    manualReviewRequired: Boolean(payment.metadata?.manualReview?.required),
                    refunds: sortRows(
                        payment.refunds.map(refund => ({ id: id(refund.id), state: refund.state })),
                    ),
                    fingerprint: entityFingerprint(payment, entityMeta('Payment')),
                })),
            ),
            lines: sortRows(
                lines.map(line => ({
                    ...pick(line, ['id', 'productVariantId', 'quantity', 'updatedAt']),
                    fulfillmentType:
                        line.customFields?.fulfillmentTypeSnapshot ??
                        line.productVariant?.customFields?.fulfillmentType ??
                        line.productVariant?.product?.customFields?.fulfillmentType ??
                        null,
                    fingerprint: entityFingerprint(line, entityMeta('OrderLine')),
                })),
            ),
            movements: sortRows(
                movements.map(row =>
                    pick(row, [
                        'id',
                        'orderLineId',
                        'productVariantId',
                        'stockLocationId',
                        'type',
                        'quantity',
                        'updatedAt',
                    ]),
                ),
            ),
            locations: sortRows(locations),
            stockLevels: sortRows(stockLevels),
            coupons: sortRows(
                couponRows.map(row => ({
                    ...pick(row, [
                        'id',
                        'channelId',
                        'customerId',
                        'promotionId',
                        'status',
                        'version',
                        'updatedAt',
                        'validFrom',
                        'validUntil',
                        'usedAt',
                        'usedOrderId',
                        'lockedAt',
                        'lockedOrderId',
                        'lockExpiresAt',
                        'returnedAt',
                        'expiredAt',
                        'returnCount',
                        'revokedAt',
                    ]),
                    fingerprint: entityFingerprint(row, entityMeta('CustomerCoupon')),
                })),
            ),
            allocations: sortRows(
                allocationRows.map(row => ({
                    ...pick(row, [
                        'id',
                        'channelId',
                        'customerCouponId',
                        'orderId',
                        'status',
                        'usedAt',
                        'releasedAt',
                        'updatedAt',
                        'refundId',
                        'refundedAt',
                        'refundedAmount',
                    ]),
                    fingerprint: entityFingerprint(row, entityMeta('CouponOrderAllocation')),
                })),
            ),
            ledger: sortRows(ledger),
            fulfillments: sortRows(order.fulfillments.map(row => ({ id: id(row.id), state: row.state }))),
            // lockForOrder updates activity timestamps itself; ownership, revision and payment
            // lock state are the comparison boundary, without persisting guest owner tokens.
            carts: sortRows(
                cartRows.map(row =>
                    pick(row, [
                        'id',
                        'channelId',
                        'checkoutOrderId',
                        'revision',
                        'projectedRevision',
                        'state',
                    ]),
                ),
            ),
            risks,
        };
        return { snapshot, fingerprint: compensationFingerprint(snapshot) };
    }

    async function lock(ctx, key, ids) {
        for (const rowId of [...new Set(ids)].sort()) {
            const row = await repository(ctx, key)
                .createQueryBuilder('row')
                .setLock('pessimistic_write')
                .where('row.id = :id', { id: rowId })
                .getOne();
            assert.ok(row, `Expected ${key} row missing while locking`);
        }
    }

    async function findReceipt(ctx, orderId) {
        const entries = await repository(ctx, 'OrderHistoryEntry').find({
            where: { order: { id: orderId }, type: 'ORDER_NOTE' },
        });
        const receipts = entries.filter(entry => entry.data?.compensation?.key === receiptKey(orderId));
        assert.ok(receipts.length <= 1, 'Duplicate compensation receipts require review');
        return receipts[0]?.data?.compensation;
    }

    async function execute(ctx, { manifest, orderId, apply = false }) {
        assert.equal(manifest?.version, LEGACY_COMPENSATION_VERSION, 'Wrong compensation version');
        assert.equal(
            manifest.authorization,
            LEGACY_COMPENSATION_AUTHORIZATION,
            'Named authorization missing',
        );
        assert.match(manifest.sourceSnapshotSha256, /^[a-f0-9]{64}$/, 'Source snapshot digest missing');
        const age = clock().getTime() - new Date(manifest.capturedAt).getTime();
        assert.ok(Number.isFinite(age) && age >= 0 && age <= 30 * 60_000, 'Reviewed snapshot is stale');
        const expected = manifest.orders.find(entry => entry.snapshot.order.id === id(orderId));
        assert.equal(
            new Set(manifest.orders.map(entry => entry.snapshot.order.id)).size,
            manifest.orders.length,
            'Duplicate reviewed orders',
        );
        assert.ok(
            manifest.orders.every(entry => LEGACY_COMPENSATION_SCOPE[entry.snapshot.order.id]),
            'Manifest exceeds original six-order scope',
        );
        assert.ok(expected && LEGACY_COMPENSATION_SCOPE[orderId], 'Order is outside reviewed scope');
        assert.equal(
            expected.fingerprint,
            compensationFingerprint(expected.snapshot),
            'Manifest snapshot digest mismatch',
        );
        assert.equal(
            id(ctx.channelId),
            LEGACY_COMPENSATION_SCOPE[orderId].channelId,
            'Context Channel mismatch',
        );
        const preview = () => validateLegacyCompensationSnapshot(expected.snapshot, clock());
        if (!apply)
            return {
                status: 'PREVIEW_ONLY',
                orderId: id(orderId),
                releases: preview(),
                fingerprint: expected.fingerprint,
            };
        preview();
        assert.equal(ctx.apiType, 'admin', 'Compensation requires a managed admin context');
        assert.ok(
            typeof ctx.userHasPermissions === 'function' && ctx.userHasPermissions([superAdminPermission]),
            'Compensation requires the native authenticated SuperAdmin permission',
        );
        const options = connection.rawConnection.options;
        if (isolatedTest) {
            assert.ok(
                ['mysql', 'mariadb'].includes(options.type),
                'Only an owned native MySQL test database is allowed',
            );
            assert.ok(
                ['127.0.0.1', 'localhost', '::1'].includes(options.host),
                'Test compensation must use loopback',
            );
            assert.match(
                String(options.database),
                /^(?:order_closure|legacy_preview)_[a-f0-9]+$/,
                'Only an owned UUID test database is allowed',
            );
        } else {
            // Runtime protection must be read and verified by the authorized execution host.
            // This is not a client input or an admin checkbox. Old a535 cannot safely release
            // resources while its Modifying orders still permit new real funding.
            const proof =
                typeof verifyProductionRuntimeProtections === 'function'
                    ? await verifyProductionRuntimeProtections()
                    : null;
            assert.ok(
                proof?.status === 'VERIFIED' &&
                    /^[a-f0-9]{40}$/.test(proof.runtimeSha) &&
                    proof.runtimeSha === proof.releaseSha &&
                    !proof.runtimeSha.startsWith('a535b99d') &&
                    /^[a-f0-9]{64}$/.test(proof.protectionsFingerprint) &&
                    proof.sourceHashesVerified === true &&
                    proof.nativeFundingGuardsVerified === true &&
                    proof.testOrderDeliveryGuardsVerified === true,
                'WAIT_REPAIR_DEPLOYMENT: actual installed native funding and test-order protections are not verified',
            );
        }
        return orders.withOrderMutationTransaction(ctx, async txCtx => {
            await carts.lockForOrder(txCtx, orderId);
            await orders.lockOrderForRefund(txCtx, orderId);
            const paymentIds = (
                await repository(txCtx, 'Payment').find({ where: { order: { id: orderId } } })
            ).map(row => row.id);
            await lock(txCtx, 'Payment', paymentIds);
            for (const coupon of expected.snapshot.coupons) {
                const current = await repository(txCtx, 'CustomerCoupon').findOne({
                    where: { id: coupon.id },
                });
                assert.ok(
                    current && (current.lockedOrderId == null || id(current.lockedOrderId) === id(orderId)),
                    'Coupon moved to a foreign Cart',
                );
                await coupons.lockCouponForRepair(txCtx, coupon.id);
            }
            await lock(
                txCtx,
                'CouponOrderAllocation',
                expected.snapshot.allocations.map(row => row.id),
            );
            await lock(
                txCtx,
                'StockLevel',
                expected.snapshot.stockLevels.map(row => row.id),
            );
            const fresh = await capture(txCtx, orderId);
            const existing = await findReceipt(txCtx, orderId);
            if (existing) {
                assert.equal(
                    existing.beforeFingerprint,
                    expected.fingerprint,
                    'Receipt belongs to a different reviewed snapshot',
                );
                // Ordinary subsequent trading may change global StockLevels. Replay checks this
                // order's immutable evidence and exact appended movements/ledger, never adjusts again.
                assert.equal(
                    compensationFingerprint(replayEvidence(fresh.snapshot)),
                    existing.afterEvidenceFingerprint,
                    'Compensated records changed; reconcile before replay',
                );
                return { ...existing, status: 'ALREADY_APPLIED', changedQuantity: 0, correctedCoupons: 0 };
            }
            assert.equal(fresh.fingerprint, expected.fingerprint, 'Persisted snapshot/version changed');
            const releases = validateLegacyCompensationSnapshot(fresh.snapshot, clock());
            for (const release of releases) {
                const line = await repository(txCtx, 'OrderLine').findOne({
                    where: { id: release.orderLineId },
                });
                const selected = await stockLocations.getReleaseLocations(txCtx, line, release.quantity);
                assert.equal(selected.length, 1, 'Native release strategy selected multiple locations');
                assert.equal(
                    id(selected[0].location?.id),
                    release.stockLocationId,
                    'Native release strategy changed original location',
                );
                assert.equal(
                    selected[0].quantity,
                    release.quantity,
                    'Native release strategy changed quantity',
                );
            }
            const newReleases = await stockMovements.createReleasesForOrderLines(
                txCtx,
                releases.map(row => ({ orderLineId: row.orderLineId, quantity: row.quantity })),
            );
            assert.equal(newReleases.length, releases.length, 'Native release count mismatch');
            for (const release of releases) {
                const matches = newReleases.filter(
                    row =>
                        id(row.orderLine?.id) === release.orderLineId &&
                        id(row.stockLocationId ?? row.stockLocation?.id) === release.stockLocationId &&
                        row.quantity === release.quantity &&
                        row.type === 'RELEASE',
                );
                assert.equal(matches.length, 1, 'Native release result mismatch');
            }
            for (const level of fresh.snapshot.stockLevels) {
                const currentLevel = await repository(txCtx, 'StockLevel').findOne({
                    where: { id: level.id },
                });
                const quantity = releases
                    .filter(
                        row =>
                            row.productVariantId === level.productVariantId &&
                            row.stockLocationId === level.stockLocationId,
                    )
                    .reduce((sum, row) => sum + row.quantity, 0);
                assert.equal(
                    currentLevel.stockOnHand,
                    level.stockOnHand,
                    'Native release changed stock on hand',
                );
                assert.equal(
                    currentLevel.stockAllocated,
                    level.stockAllocated - quantity,
                    'Native release allocation delta mismatch',
                );
                assert.ok(currentLevel.stockAllocated >= 0, 'Native release produced negative allocation');
            }
            const ledgerIds = [];
            for (const original of fresh.snapshot.coupons) {
                const transition = await repository(txCtx, 'CustomerCoupon').update(
                    {
                        id: original.id,
                        channelId: original.channelId,
                        version: original.version,
                        status: 'USED',
                        usedOrderId: orderId,
                    },
                    {
                        status: 'EXPIRED',
                        expiredAt: clock(),
                        lockedOrderId: null,
                        lockedAt: null,
                        lockExpiresAt: null,
                    },
                );
                assert.equal(transition.affected, 1, 'Coupon compare-and-set failed');
                const allocation = fresh.snapshot.allocations.find(
                    row => row.customerCouponId === original.id,
                );
                const allocationTransition = await repository(txCtx, 'CouponOrderAllocation').update(
                    { id: allocation.id, channelId: original.channelId, orderId, status: 'USED' },
                    {
                        status: 'RELEASED',
                        releasedAt: allocation.releasedAt ? new Date(allocation.releasedAt) : clock(),
                    },
                );
                assert.equal(allocationTransition.affected, 1, 'Coupon allocation compare-and-set failed');
                for (const eventType of ['CORRECTED', 'EXPIRED']) {
                    const correctionEntry = await repository(txCtx, 'CouponLedgerEntry').save(
                        new entities.CouponLedgerEntry({
                            channelId: original.channelId,
                            customerCouponId: original.id,
                            promotionId: original.promotionId,
                            customerId: original.customerId,
                            orderId,
                            refundId: null,
                            eventType,
                            actorType: 'ADMIN',
                            idempotencyKey: `${receiptKey(orderId)}:${original.id}:${eventType}`,
                            discountAmount: null,
                            note: '授权原历史模拟订单补偿：保留原核销账，原已过期权益失效，不补发新券',
                            metadata: {
                                compensationKey: receiptKey(orderId),
                                beforeFingerprint: fresh.fingerprint,
                                originalCoupon: original,
                                originalAllocation: allocation,
                            },
                        }),
                    );
                    ledgerIds.push(id(correctionEntry.id));
                }
                const customer = await repository(txCtx, 'CustomerCoupon').findOne({
                    where: { id: original.id },
                    relations: { customer: { user: true } },
                });
                await coupons.publishCustomerCouponChanged(txCtx, customer.customer);
            }
            const after = await capture(txCtx, orderId);
            assert.deepEqual(
                after.snapshot.order,
                fresh.snapshot.order,
                'Compensation changed original order',
            );
            assert.deepEqual(
                after.snapshot.payments,
                fresh.snapshot.payments,
                'Compensation changed original payments',
            );
            assert.deepEqual(
                after.snapshot.lines,
                fresh.snapshot.lines,
                'Compensation changed original order lines',
            );
            assert.deepEqual(
                after.snapshot.fulfillments,
                fresh.snapshot.fulfillments,
                'Compensation changed fulfillment evidence',
            );
            assert.deepEqual(
                after.snapshot.risks,
                fresh.snapshot.risks,
                'Risk evidence changed during compensation',
            );
            assert.deepEqual(
                after.snapshot.locations,
                fresh.snapshot.locations,
                'Original stock location ownership changed',
            );
            const addedIds = new Set(newReleases.map(row => id(row.id)));
            assert.deepEqual(
                after.snapshot.movements.filter(row => !addedIds.has(row.id)),
                fresh.snapshot.movements,
                'Original stock history changed',
            );
            assert.equal(
                after.snapshot.movements.length,
                fresh.snapshot.movements.length + addedIds.size,
                'Unexpected stock movements appeared',
            );
            for (const original of fresh.snapshot.ledger) {
                assert.deepEqual(
                    after.snapshot.ledger.find(row => row.id === original.id),
                    original,
                    'Original coupon ledger changed',
                );
            }
            for (const original of fresh.snapshot.coupons) {
                const corrected = after.snapshot.coupons.find(row => row.id === original.id);
                assert.equal(corrected.status, 'EXPIRED', 'Coupon was not expired');
                assert.equal(
                    corrected.version,
                    original.version + 1,
                    'Coupon version did not advance exactly once',
                );
                assert.equal(corrected.usedAt, original.usedAt, 'Original coupon usage time changed');
                assert.equal(
                    corrected.usedOrderId,
                    original.usedOrderId,
                    'Original coupon usage linkage changed',
                );
                assert.equal(
                    corrected.returnCount,
                    original.returnCount,
                    'An entitlement was returned or reissued',
                );
                assert.equal(corrected.lockedOrderId, null, 'Coupon lock remains');
            }
            const receipt = {
                key: receiptKey(orderId),
                version: LEGACY_COMPENSATION_VERSION,
                authorization: manifest.authorization,
                orderId: id(orderId),
                salesChannelId: id(txCtx.channelId),
                sourceSnapshotSha256: manifest.sourceSnapshotSha256,
                beforeFingerprint: fresh.fingerprint,
                afterFingerprint: after.fingerprint,
                afterEvidenceFingerprint: compensationFingerprint(replayEvidence(after.snapshot)),
                before: fresh.snapshot,
                releaseIds: newReleases.map(row => id(row.id)),
                ledgerIds,
                changedQuantity: releases.reduce((sum, row) => sum + row.quantity, 0),
                correctedCoupons: fresh.snapshot.coupons.length,
                appliedAt: clock().toISOString(),
                automaticRecoveryAllowed: false,
                productionCompleted: false,
                productionCompletionStatus: isolatedTest
                    ? 'NOT_APPLICABLE_ISOLATED_TEST'
                    : 'NATIVE_CACHE_REFRESH_AND_READBACK_REQUIRED',
            };
            const entry = await history.createHistoryEntryForOrder(
                {
                    ctx: txCtx,
                    orderId,
                    type: 'ORDER_NOTE',
                    data: {
                        note: '已授权历史模拟订单库存/过期券补偿；原订单和付款记录保留',
                        compensation: receipt,
                    },
                },
                false,
            );
            return { ...receipt, status: 'APPLIED', historyEntryId: id(entry.id) };
        });
    }

    return { capture, execute };
}

function replayEvidence(snapshot) {
    const { stockLevels: _stockLevels, ...ownedEvidence } = snapshot;
    return ownedEvidence;
}
