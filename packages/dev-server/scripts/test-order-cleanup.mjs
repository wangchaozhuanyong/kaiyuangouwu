import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const derived = new Set([
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
    'physical_return_receipt',
    'fulfillment_delivery_record',
    'fulfillment_delivery_event',
    'coupon_order_allocation',
    'coupon_ledger_entry',
    'referral_reward',
    'referral_balance_use',
    'referral_ledger_entry',
    'referral_wallet_usage',
    'storefront_order_attribution',
    'storefront_usdt_checkout_quote',
    'storefront_usdt_payment_intent',
    'store_usdt_manual_refund',
    'store_usdt_reconciliation_action',
    'customer_service_review',
    'customer_service_feedback',
    'fraud_risk_case',
    'storefront_cart_checkout',
    'storefront_cart_checkout_line',
    'admin_notification_outbox',
    'store_notification_read',
]);
const retained = new Set([
    'stock_level',
    'catalog_inventory_lot',
    'auto_card_pool_item',
    'digital_variant_config',
    'customer_coupon',
    'referral_wallet',
    'customer_operations_profile',
    'session',
    'storefront_cart',
    'storefront_cart_line',
]);
const implicit = {
    orderId: 'order',
    activeOrderId: 'order',
    checkoutOrderId: 'order',
    lockedOrderId: 'order',
    usedOrderId: 'order',
    orderLineId: 'order_line',
    paymentId: 'payment',
    refundId: 'refund',
    fulfillmentId: 'fulfillment',
    requestId: 'after_sales_request',
    stockMovementId: 'stock_movement',
    checkoutId: 'storefront_cart_checkout',
};
const notificationSources = {
    Order: 'order',
    Payment: 'payment',
    Refund: 'refund',
    Fulfillment: 'fulfillment',
    AfterSalesRequest: 'after_sales_request',
};
const parentExpansion = new Set(['fulfillment', 'shipping_line', 'surcharge']);
const valueKey = value => (value == null ? '' : String(value));
const json = value =>
    JSON.stringify(
        value,
        (_key, item) => {
            if (typeof item === 'bigint') return String(item);
            if (ArrayBuffer.isView(item))
                return {
                    type: 'Buffer',
                    data: [...new Uint8Array(item.buffer, item.byteOffset, item.byteLength)],
                };
            return item;
        },
        0,
    );
export const digest = value => createHash('sha256').update(json(value)).digest('hex');
function canonical(value) {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value))
        return canonical({
            type: 'Buffer',
            data: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)],
        });
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value))
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonical(value[key])]),
        );
    return value;
}
const hash = value => digest(canonical(value));
const equal = (a, b) => hash(a) === hash(b);
function metadataJson(value) {
    try {
        return typeof value === 'string' ? JSON.parse(value) : (value ?? {});
    } catch {
        return {};
    }
}
function references(table) {
    const refs = table.foreignKeys.map(key => ({
        columns: key.columns,
        target: key.target,
        targetColumns: key.targetColumns,
    }));
    for (const [column, target] of Object.entries(implicit))
        if (table.columns.includes(column) && !refs.some(ref => ref.columns.includes(column)))
            refs.push({ columns: [column], target, targetColumns: ['id'] });
    if (table.columns.includes('deliveryId') && !refs.some(ref => ref.columns.includes('deliveryId'))) {
        const known = {
            manual_digital_delivery_event: 'manual_digital_delivery',
            auto_card_delivery_event: 'auto_card_delivery',
            auto_card_pool_item: 'auto_card_delivery',
        }[table.name];
        for (const target of known ? [known] : ['auto_card_delivery', 'manual_digital_delivery'])
            refs.push({ columns: ['deliveryId'], target, targetColumns: ['id'], ambiguous: !known });
    }
    return refs;
}
function rowKey(table, row) {
    return hash(
        Object.fromEntries(
            (table.primaryKeys.length ? table.primaryKeys : table.columns).map(column => [
                column,
                row[column],
            ]),
        ),
    );
}
function safeNumber(value, label) {
    const number = Number(value);
    assert.ok(Number.isSafeInteger(number), `${label} is not a safe integer`);
    return number;
}
function tracked(freeze, variantId) {
    const map = freeze.trackingByVariant ?? {};
    return typeof map[valueKey(variantId)] === 'boolean' ? map[valueKey(variantId)] : undefined;
}

/** Pure preview. Full rows stay private and are encrypted before any persistent backup. */
export function buildCleanupPlan(snapshot, freeze) {
    assert.equal(freeze.version, 1);
    assert.match(freeze.targetFingerprint, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isFinite(Date.parse(freeze.cutoff)));
    assert.ok(Array.isArray(freeze.orderIds) && freeze.orderIds.length > 0);
    assert.equal(snapshot.targetFingerprint, freeze.targetFingerprint, 'Wrong database instance');
    const schemas = new Map(snapshot.tables.map(table => [table.name, table]));
    const rows = snapshot.rows;
    const selected = new Map(snapshot.tables.map(table => [table.name, new Map()]));
    const blockers = [];
    const patches = [];
    const addBlock = (code, table, id, detail) => blockers.push({ code, table, id: valueKey(id), detail });
    const add = (name, row) => {
        const table = schemas.get(name);
        if (!table) return false;
        const key = rowKey(table, row);
        if (selected.get(name).has(key)) return false;
        selected.get(name).set(key, row);
        return true;
    };
    const ids = new Set(freeze.orderIds.map(valueKey));
    for (const row of rows.order ?? []) if (ids.has(valueKey(row.id))) add('order', row);
    for (const id of ids)
        if (![...(selected.get('order')?.values() ?? [])].some(row => valueKey(row.id) === id))
            addBlock(
                'FROZEN_ORDER_MISSING',
                'order',
                id,
                'Order missing; only a matching committed post-state can be treated as idempotent',
            );
    const cutoff = Date.parse(freeze.cutoff);
    for (const row of rows.order ?? []) {
        if (ids.has(valueKey(row.id)) && Date.parse(row.createdAt) > cutoff)
            addBlock('ORDER_AFTER_CUTOFF', 'order', row.id, 'Order was not present at the frozen cutoff');
        if (!ids.has(valueKey(row.id)))
            addBlock(
                'UNFROZEN_ORDER',
                'order',
                row.id,
                'A surviving order prevents treating customer totals and unbound quotas as zero',
            );
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const table of snapshot.tables)
            for (const row of rows[table.name] ?? []) {
                if (table.name === 'order') continue;
                const refs = references(table);
                if (
                    refs.some(
                        ref =>
                            !retained.has(ref.target) &&
                            [...(selected.get(ref.target)?.values() ?? [])].some(parent =>
                                ref.columns.every(
                                    (column, index) =>
                                        row[column] != null &&
                                        valueKey(row[column]) === valueKey(parent[ref.targetColumns[index]]),
                                ),
                            ),
                    )
                )
                    changed = add(table.name, row) || changed;
                if (
                    table.name === 'referral_wallet_usage' &&
                    ids.has(valueKey(metadataJson(row.metadata).orderId))
                )
                    changed = add(table.name, row) || changed;
                if (
                    ['customer_service_review', 'customer_service_feedback'].includes(table.name) &&
                    (rows.order ?? []).some(
                        order =>
                            ids.has(valueKey(order.id)) &&
                            row.orderCode != null &&
                            valueKey(row.orderCode) === valueKey(order.code),
                    )
                )
                    changed = add(table.name, row) || changed;
                if (
                    table.name === 'referral_ledger_entry' &&
                    [...(selected.get('referral_wallet_usage')?.values() ?? [])].some(
                        usage => valueKey(usage.id) === valueKey(metadataJson(row.metadata).usageId),
                    )
                )
                    changed = add(table.name, row) || changed;
                if (
                    table.name === 'admin_notification_outbox' &&
                    (ids.has(valueKey(metadataJson(row.payload).orderId)) ||
                        [...(selected.get(notificationSources[row.sourceType])?.values() ?? [])].some(
                            parent => valueKey(parent.id) === valueKey(row.sourceId),
                        ))
                )
                    changed = add(table.name, row) || changed;
                if (table.name === 'store_notification_read') {
                    const [, kind, sourceId, version] =
                        String(row.eventKey ?? '').match(/^(ORDER|AFTER_SALES):([^:]+):(.+)$/u) ?? [];
                    const target =
                        kind === 'ORDER'
                            ? 'order'
                            : kind === 'AFTER_SALES'
                              ? 'after_sales_request'
                              : undefined;
                    if (
                        target &&
                        [...(selected.get(target)?.values() ?? [])].some(
                            parent => valueKey(parent.id) === sourceId,
                        )
                    ) {
                        if (!Number.isFinite(Date.parse(version)))
                            addBlock(
                                'NOTIFICATION_REFERENCE_UNKNOWN',
                                table.name,
                                row.id,
                                'Invalid notification version; preserve unknown reference',
                            );
                        changed = add(table.name, row) || changed;
                    }
                }
            }
        for (const [name, records] of selected)
            for (const row of records.values()) {
                const table = schemas.get(name);
                for (const ref of references(table))
                    if (parentExpansion.has(ref.target))
                        for (const parent of rows[ref.target] ?? [])
                            if (
                                ref.columns.every(
                                    (column, index) =>
                                        row[column] != null &&
                                        valueKey(row[column]) === valueKey(parent[ref.targetColumns[index]]),
                                )
                            )
                                changed = add(ref.target, parent) || changed;
            }
    }
    const chosen = name => [...(selected.get(name)?.values() ?? [])];
    const isChosen = (name, row) =>
        Boolean(schemas.get(name) && selected.get(name).has(rowKey(schemas.get(name), row)));
    const addPatch = (table, row, values, reason) => {
        if (!schemas.has(table)) return addBlock('MISSING_BASELINE_TABLE', table, row?.id, reason);
        if (!schemas.get(table).primaryKeys.length)
            return addBlock('BASELINE_PRIMARY_KEY_MISSING', table, row?.id, reason);
        const old = patches.find(
            patch => patch.table === table && patch.key === rowKey(schemas.get(table), row),
        );
        if (old) {
            Object.assign(old.after, values);
            old.reasons.push(reason);
            return;
        }
        patches.push({
            table,
            key: rowKey(schemas.get(table), row),
            identity: Object.fromEntries(schemas.get(table).primaryKeys.map(column => [column, row[column]])),
            before: row,
            after: { ...row, ...values },
            reasons: [reason],
        });
    };
    for (const session of chosen('session'))
        addPatch(
            'session',
            session,
            { activeOrderId: null },
            'Keep authentication/session identity; clear only the frozen active order',
        );
    for (const cart of chosen('storefront_cart')) {
        const values = { checkoutOrderId: null };
        if (Object.hasOwn(cart, 'projectedRevision')) values.projectedRevision = null;
        if (Object.hasOwn(cart, 'state')) values.state = 'OPEN';
        if (Object.hasOwn(cart, 'revision')) values.revision = safeNumber(cart.revision, 'cartRevision') + 1;
        addPatch(
            'storefront_cart',
            cart,
            values,
            'Keep cart ownership and contents; invalidate only the frozen checkout projection',
        );
    }
    for (const line of chosen('storefront_cart_line'))
        addPatch(
            'storefront_cart_line',
            line,
            { orderLineId: null },
            'Keep unconsumed cart quantity and selection; detach frozen order-line projection',
        );
    for (const [name, records] of selected)
        if (records.size && derived.has(name) && !schemas.get(name).primaryKeys.length)
            addBlock(
                'DERIVED_PRIMARY_KEY_MISSING',
                name,
                '',
                'Related rows cannot be durably identified for deletion and recovery',
            );
    for (const [name, records] of selected)
        if (records.size && !derived.has(name) && !retained.has(name))
            addBlock(
                'UNMAPPED_DERIVED_TABLE',
                name,
                '',
                `${records.size} related records lack an explicit deletion or baseline-restoration policy`,
            );
    // A shared fulfillment or any unselected incoming reference must survive; deleting it would affect another order.
    for (const table of snapshot.tables)
        for (const row of rows[table.name] ?? [])
            if (!isChosen(table.name, row))
                for (const ref of references(table))
                    if (
                        derived.has(ref.target) &&
                        chosen(ref.target).some(parent =>
                            ref.columns.every(
                                (column, index) =>
                                    row[column] != null &&
                                    valueKey(row[column]) === valueKey(parent[ref.targetColumns[index]]),
                            ),
                        )
                    )
                        addBlock(
                            'UNSELECTED_REFERENCE',
                            table.name,
                            row.id,
                            `Still references a target ${ref.target}; no cascade outside the frozen graph is allowed`,
                        );
    for (const table of snapshot.tables)
        if (chosen(table.name).length && references(table).some(ref => ref.ambiguous))
            addBlock(
                'AMBIGUOUS_DELIVERY_PARENT',
                table.name,
                '',
                'deliveryId has no real FK or approved parent type; do not map a manual event to auto-card delivery',
            );
    const movements = chosen('stock_movement');
    const groups = new Map();
    for (const move of movements) {
        const variantId = move.productVariantId;
        const locationId = move.stockLocationId;
        if (
            variantId == null ||
            locationId == null ||
            move.orderLineId == null ||
            !['ALLOCATION', 'SALE', 'CANCELLATION', 'RELEASE'].includes(move.type)
        ) {
            addBlock(
                'UNMAPPED_STOCK_MOVEMENT',
                'stock_movement',
                move.id,
                'Warehouse, SKU, order line or movement type cannot be explained',
            );
            continue;
        }
        const quantity = safeNumber(move.quantity, 'Stock movement quantity');
        if ((move.type === 'SALE' && quantity > 0) || (move.type !== 'SALE' && quantity < 0))
            addBlock('INVALID_MOVEMENT_SIGN', 'stock_movement', move.id, move.type);
        const key = `${variantId}:${locationId}`;
        const group = groups.get(key) ?? {
            variantId,
            locationId,
            allocatedNet: 0,
            onHandNet: 0,
            movementIds: [],
        };
        if (move.type === 'ALLOCATION' || move.type === 'SALE') group.allocatedNet += quantity;
        if (move.type === 'RELEASE') group.allocatedNet -= quantity;
        if (move.type === 'SALE' || move.type === 'CANCELLATION') group.onHandNet += quantity;
        group.movementIds.push(valueKey(move.id));
        groups.set(key, group);
        if (
            ['SALE', 'CANCELLATION', 'RELEASE'].includes(move.type) &&
            new Set(
                movements
                    .filter(
                        item =>
                            valueKey(item.orderLineId) === valueKey(move.orderLineId) &&
                            item.type === move.type,
                    )
                    .map(item => valueKey(item.stockLocationId)),
            ).size > 1
        )
            addBlock(
                'AMBIGUOUS_MULTI_WAREHOUSE_QUANTITY',
                'stock_movement',
                move.id,
                'Core movement quantities may duplicate full line quantity across warehouses; a verified allocation map is required',
            );
    }
    for (const group of groups.values()) {
        const level = (rows.stock_level ?? []).find(
            row =>
                valueKey(row.productVariantId) === valueKey(group.variantId) &&
                valueKey(row.stockLocationId) === valueKey(group.locationId),
        );
        const policy = tracked(freeze, group.variantId);
        if (policy === undefined)
            addBlock(
                'TRACKING_HISTORY_UNCONFIRMED',
                'stock_level',
                level?.id,
                `SKU ${group.variantId}: explain allocated delta ${-group.allocatedNet}, on-hand delta ${-group.onHandNet} and verify historical trackInventory`,
            );
        if (!level && policy !== false)
            addBlock(
                'STOCK_BASELINE_MISSING',
                'stock_level',
                '',
                `SKU ${group.variantId} warehouse ${group.locationId}`,
            );
        if (level && policy === true) {
            const stockAllocated = safeNumber(level.stockAllocated, 'Stock allocated') - group.allocatedNet;
            const stockOnHand = safeNumber(level.stockOnHand, 'Stock on hand') - group.onHandNet;
            if (stockAllocated < 0 || stockOnHand < 0)
                addBlock(
                    'NEGATIVE_RESTORED_STOCK',
                    'stock_level',
                    level.id,
                    'Net stock restoration would be negative',
                );
            else
                addPatch(
                    'stock_level',
                    level,
                    { stockAllocated, stockOnHand },
                    'Undo the net order movement once; cancellations and releases are already included',
                );
        }
    }
    const lotMoves = chosen('catalog_inventory_lot_movement');
    for (const lotId of new Set(lotMoves.map(row => valueKey(row.lotId)))) {
        const lot = (rows.catalog_inventory_lot ?? []).find(row => valueKey(row.id) === lotId);
        const net = lotMoves
            .filter(row => valueKey(row.lotId) === lotId)
            .reduce((sum, row) => sum + safeNumber(row.quantity, 'Lot movement'), 0);
        if (!lot)
            addBlock(
                'LOT_BASELINE_MISSING',
                'catalog_inventory_lot',
                lotId,
                'Lot movement has no baseline lot',
            );
        else if (safeNumber(lot.quantityOnHand, 'Lot stock') - net < 0)
            addBlock(
                'NEGATIVE_RESTORED_LOT',
                'catalog_inventory_lot',
                lotId,
                'Net lot rollback would be negative',
            );
        else
            addPatch(
                'catalog_inventory_lot',
                lot,
                { quantityOnHand: safeNumber(lot.quantityOnHand, 'Lot stock') - net },
                'Restore the lot ledger independently from the warehouse balance; no second stock adjustment event',
            );
    }
    for (const group of groups.values()) {
        const corresponding = lotMoves.filter(
            row =>
                valueKey(row.variantId) === valueKey(group.variantId) &&
                valueKey(row.stockLocationId) === valueKey(group.locationId),
        );
        if (
            corresponding.length &&
            corresponding.reduce((sum, row) => sum + safeNumber(row.quantity, 'Lot quantity'), 0) !==
                group.onHandNet
        )
            addBlock(
                'LOT_WAREHOUSE_NET_MISMATCH',
                'catalog_inventory_lot_movement',
                '',
                `SKU ${group.variantId} warehouse ${group.locationId}: lot and warehouse deltas differ`,
            );
    }
    for (const name of ['packaging_unpack_event', 'physical_return_receipt'])
        if (chosen(name).length)
            addBlock(
                'PACKAGING_OR_RETURN_MAP_REQUIRED',
                name,
                '',
                'Preview retains quantities but a verified parent/child SKU and warehouse mapping is required before deleting',
            );
    const poolIds = new Set();
    for (const reservation of chosen('digital_order_reservation')) {
        const pool = metadataJson(reservation.poolItemIdsJson);
        if (!Array.isArray(pool))
            addBlock(
                'INVALID_RESERVED_POOL_MAPPING',
                'digital_order_reservation',
                reservation.id,
                'poolItemIdsJson is not a list',
            );
        else for (const id of pool) poolIds.add(valueKey(id));
        if (reservation.stockPolicy === 'limited')
            addBlock(
                'UNBOUND_DIGITAL_QUOTA_LEDGER',
                'digital_order_reservation',
                reservation.id,
                `Preview restore ${Number(reservation.quantity) - Number(reservation.releasedQuantity)} units; ` +
                    'HOLD/RELEASE eventKey has no order binding and requires verified reconciliation',
            );
    }
    for (const item of rows.auto_card_pool_item ?? [])
        if (
            poolIds.has(valueKey(item.id)) ||
            chosen('auto_card_delivery').some(delivery => valueKey(delivery.id) === valueKey(item.deliveryId))
        ) {
            const delivery = chosen('auto_card_delivery').find(
                record => valueKey(record.id) === valueKey(item.deliveryId),
            );
            const revealed = (rows.governance_audit_entry ?? []).some(
                record =>
                    (record.resourceType === 'AutoCardPoolItem' &&
                        valueKey(record.resourceId) === valueKey(item.id) &&
                        record.eventType === 'AUTO_CARD_POOL_SECRET_REVEALED') ||
                    (delivery &&
                        record.resourceType === 'AutoCardDelivery' &&
                        valueKey(record.resourceId) === valueKey(delivery.id) &&
                        record.eventType === 'AUTO_CARD_SOLD_SECRET_REVEALED'),
            );
            const attestedUnrevealed = (freeze.unrevealedPoolItemIds ?? [])
                .map(valueKey)
                .includes(valueKey(item.id));
            const available =
                item.state === 'RESERVED' &&
                !item.assignedAt &&
                !delivery?.sentAt &&
                !delivery?.lastDispatchedAt &&
                !['SENT', 'DELIVERED', 'COMPLETED', 'DISPATCHING'].includes(delivery?.state) &&
                !revealed &&
                attestedUnrevealed;
            const values = {
                state: available ? 'AVAILABLE' : 'DISABLED',
                deliveryId: null,
                assignedAt: item.assignedAt ?? null,
            };
            if (schemas.get('auto_card_pool_item').columns.includes('disabledReason'))
                values.disabledReason = available
                    ? null
                    : '测试订单清理：历史分配或揭示情况未证明，禁止自动重新售卖';
            addPatch(
                'auto_card_pool_item',
                item,
                values,
                available
                    ? 'Exact unexposed RESERVED item may return to stock after stock-map verification'
                    : 'Assigned, dispatched, revealed or unknown card remains DISABLED; preserve encrypted payload and fingerprint',
            );
            add('auto_card_pool_item', item);
            addBlock(
                'DIGITAL_POOL_STOCK_MAPPING_REQUIRED',
                'auto_card_pool_item',
                item.id,
                'Pool restoration is previewed; verify the source-channel quota and warehouse stock synchronization before applying',
            );
        }
    for (const coupon of chosen('customer_coupon')) {
        const status =
            coupon.validUntil && Date.parse(coupon.validUntil) <= cutoff
                ? 'EXPIRED'
                : ['REVOKED', 'EXPIRED'].includes(coupon.status)
                  ? coupon.status
                  : 'AVAILABLE';
        addPatch(
            'customer_coupon',
            coupon,
            {
                status,
                lockedOrderId: null,
                usedOrderId: null,
                lockedAt: null,
                lockExpiresAt: null,
                usedAt: null,
            },
            'Keep the issued entitlement and claim quota; remove only frozen order usage',
        );
    }
    for (const walletId of new Set(chosen('referral_ledger_entry').map(row => valueKey(row.walletId)))) {
        const wallet = (rows.referral_wallet ?? []).find(row => valueKey(row.id) === walletId);
        const entries = chosen('referral_ledger_entry').filter(row => valueKey(row.walletId) === walletId);
        const other = (rows.referral_ledger_entry ?? []).filter(
            row => valueKey(row.walletId) === walletId && !isChosen('referral_ledger_entry', row),
        );
        const earliest = Math.min(...entries.map(row => Date.parse(row.createdAt)));
        if (
            other.some(
                row => !Number.isFinite(Date.parse(row.createdAt)) || Date.parse(row.createdAt) >= earliest,
            )
        )
            addBlock(
                'MIXED_WALLET_TIMELINE',
                'referral_wallet',
                walletId,
                'Later or undated non-target ledger snapshots would need rebasing',
            );
        if ((rows.referral_withdrawal ?? []).some(row => valueKey(row.walletId) === walletId))
            addBlock(
                'WITHDRAWAL_MAPPING_REQUIRED',
                'referral_wallet',
                walletId,
                'Withdrawals are not attributed to unique target orders; preserve external evidence and stop',
            );
        if (!wallet) {
            addBlock('WALLET_BASELINE_MISSING', 'referral_wallet', walletId, 'Missing affected wallet');
            continue;
        }
        const ledger = (rows.referral_ledger_entry ?? []).filter(row => valueKey(row.walletId) === walletId);
        const latestTime = Math.max(...ledger.map(row => Date.parse(row.createdAt)));
        const latest = ledger.filter(row => Date.parse(row.createdAt) === latestTime);
        const last = latest
            .sort((a, b) => safeNumber(a.id, 'ledgerId') - safeNumber(b.id, 'ledgerId'))
            .at(-1);
        for (const [balance, after] of [
            ['availableBalance', 'availableAfter'],
            ['pendingBalance', 'pendingAfter'],
            ['reservedBalance', 'reservedAfter'],
        ]) {
            if (
                schemas.get('referral_ledger_entry').columns.includes(after) &&
                (!last ||
                    last[after] == null ||
                    safeNumber(last[after], after) !== safeNumber(wallet[balance], balance))
            )
                addBlock(
                    'WALLET_LEDGER_BASELINE_MISMATCH',
                    'referral_wallet',
                    walletId,
                    `Current ${balance} is not the latest ledger ${after}; no unexplained wallet correction is allowed`,
                );
        }
        const values = {};
        for (const [balance, delta] of [
            ['availableBalance', 'availableDelta'],
            ['pendingBalance', 'pendingDelta'],
            ['reservedBalance', 'reservedDelta'],
        ])
            values[balance] =
                safeNumber(wallet[balance], balance) -
                entries.reduce((sum, row) => sum + safeNumber(row[delta], delta), 0);
        if (Object.values(values).some(value => value < 0))
            addBlock(
                'NEGATIVE_RESTORED_WALLET',
                'referral_wallet',
                walletId,
                'Net rollback would consume unrelated funds',
            );
        else
            addPatch(
                'referral_wallet',
                wallet,
                values,
                'Reverse only the sum of frozen order ledger deltas; keep account and unrelated starting balance',
            );
    }
    for (const name of ['storefront_usdt_payment_intent', 'store_usdt_manual_refund'])
        for (const row of chosen(name))
            if (row.transactionId || Number(row.blockNumber) > 0 || row.matchedTransactionId)
                addBlock(
                    'EXTERNAL_CHAIN_EVIDENCE',
                    name,
                    row.id,
                    'On-chain proof must remain auditable and have an explained account reconciliation before deletion; no transfers are performed',
                );
    const customers = new Set(
        chosen('order')
            .map(row => valueKey(row.customerId))
            .filter(Boolean),
    );
    for (const profile of rows.customer_operations_profile ?? [])
        if (customers.has(valueKey(profile.customerId))) {
            const values = Object.fromEntries(
                [
                    'orderCount',
                    'grossRevenue',
                    'refundTotal',
                    'netLifetimeValue',
                    'averageOrderValue',
                    'frequencyScore',
                    'monetaryScore',
                    'recencyScore',
                    'afterSalesCount',
                    'openAfterSalesCount',
                ]
                    .filter(column => schemas.get('customer_operations_profile').columns.includes(column))
                    .map(column => [column, 0]),
            );
            Object.assign(values, {
                lastOrderAt: null,
                currencyMetricsJson: '{}',
                evaluationVersion: 'STALE_TEST_ORDER_CLEANUP',
            });
            addPatch(
                'customer_operations_profile',
                profile,
                values,
                'Invalidate only order-derived metrics; keep doNotContact, team ownership and service follow-up preferences',
            );
        }
    const deletes = [...selected]
        .filter(([name]) => derived.has(name))
        .flatMap(([name, records]) =>
            [...records].map(([key, row]) => ({
                table: name,
                key,
                identity: Object.fromEntries(
                    (schemas.get(name).primaryKeys.length
                        ? schemas.get(name).primaryKeys
                        : schemas.get(name).columns
                    ).map(column => [column, row[column]]),
                ),
                rowHash: hash(row),
            })),
        );
    // Topological table order. Cycles must be explained rather than disabling foreign keys.
    const names = new Set(deletes.map(record => record.table));
    const deleteOrder = [];
    while (names.size) {
        const leaves = [...names].filter(
            name =>
                ![...names].some(
                    child =>
                        child !== name && references(schemas.get(child)).some(ref => ref.target === name),
                ),
        );
        if (!leaves.length) {
            addBlock('DELETE_DEPENDENCY_CYCLE', '', '', [...names].join(','));
            break;
        }
        leaves.sort().forEach(name => {
            names.delete(name);
            deleteOrder.push(name);
        });
    }
    for (const name of deleteOrder) {
        const pending = deletes.filter(record => record.table === name);
        const ordered = [];
        while (pending.length) {
            const leaves = pending.filter(
                parent =>
                    !pending.some(
                        child =>
                            child !== parent &&
                            references(schemas.get(name))
                                .filter(ref => ref.target === name)
                                .some(ref =>
                                    ref.columns.every((column, index) => {
                                        const childRow = selected.get(name).get(child.key);
                                        const parentRow = selected.get(name).get(parent.key);
                                        return (
                                            childRow[column] != null &&
                                            valueKey(childRow[column]) ===
                                                valueKey(parentRow[ref.targetColumns[index]])
                                        );
                                    }),
                                ),
                    ),
            );
            if (!leaves.length) {
                addBlock(
                    'DELETE_RECORD_DEPENDENCY_CYCLE',
                    name,
                    '',
                    'Self-referencing records need an explicit safe ordering or nullable-edge plan',
                );
                break;
            }
            for (const leaf of leaves) {
                ordered.push(leaf);
                pending.splice(pending.indexOf(leaf), 1);
            }
        }
        const offset = deletes.findIndex(record => record.table === name);
        if (offset >= 0 && ordered.length) deletes.splice(offset, ordered.length, ...ordered);
    }
    const gates = [];
    if (freeze.allOrdersAtCutoffAreTest !== true) gates.push('TEST_ORDER_SCOPE_NOT_CONFIRMED');
    if (freeze.writersPaused !== true || freeze.queuesPaused !== true)
        gates.push('WRITERS_AND_WORKERS_NOT_VERIFIED_PAUSED');
    if (!freeze.freezeEvidenceHash?.match(/^[a-f0-9]{64}$/u)) gates.push('FREEZE_EVIDENCE_NOT_BOUND');
    const privatePlan = {
        version: 1,
        targetFingerprint: freeze.targetFingerprint,
        cutoff: freeze.cutoff,
        orderSetHash: digest(freeze.orderIds.map(String).sort()),
        freezeHash: hash(freeze),
        snapshotHash: hash(snapshot),
        deletes,
        patches,
        deleteOrder,
        blockers,
        gates,
        inventoryNet: [...groups.values()],
    };
    privatePlan.planHash = hash(privatePlan);
    return privatePlan;
}

export function publicCleanupPreview(plan) {
    return {
        version: plan.version,
        targetFingerprint: plan.targetFingerprint,
        cutoff: plan.cutoff,
        orderSetHash: plan.orderSetHash,
        freezeHash: plan.freezeHash,
        snapshotHash: plan.snapshotHash,
        planHash: plan.planHash,
        canApply: !plan.blockers.length && !plan.gates.length,
        deletionCounts: Object.fromEntries(
            plan.deleteOrder.map(name => [name, plan.deletes.filter(record => record.table === name).length]),
        ),
        preservedBaselineChanges: plan.patches.map(patch => ({
            table: patch.table,
            identity: patch.identity,
            changes: Object.fromEntries(
                Object.keys(patch.after)
                    .filter(key => !equal(patch.after[key], patch.before[key]))
                    .map(key => [key, { before: patch.before[key], after: patch.after[key] }]),
            ),
            reasons: patch.reasons,
        })),
        inventoryNet: plan.inventoryNet,
        blockers: plan.blockers,
        gates: plan.gates,
        externalActions: [],
    };
}

export function sealBackup(snapshot, freeze, plan, key) {
    assert.ok(Buffer.isBuffer(key) && key.length === 32, 'A 32-byte backup encryption key is required');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const content = Buffer.concat([cipher.update(json({ snapshot, freeze, plan })), cipher.final()]);
    const envelope = {
        version: 1,
        algorithm: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: content.toString('base64'),
    };
    return { envelope, backupHash: hash(envelope) };
}
export function openBackup(envelope, expectedHash, key) {
    assert.equal(hash(envelope), expectedHash, 'Backup hash mismatch');
    assert.equal(envelope.algorithm, 'aes-256-gcm');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const parsed = JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]).toString(
            'utf8',
        ),
        (_key, value) =>
            value &&
            value.type === 'Buffer' &&
            Array.isArray(value.data) &&
            Object.keys(value).length === 2 &&
            value.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
                ? Buffer.from(value.data)
                : value,
    );
    assert.equal(hash(parsed.snapshot), parsed.plan.snapshotHash, 'Backup snapshot mismatch');
    assert.equal(hash(parsed.freeze), parsed.plan.freezeHash, 'Backup freeze mismatch');
    const { planHash, ...body } = parsed.plan;
    assert.equal(hash(body), planHash, 'Backup plan mismatch');
    return parsed;
}

export async function databaseFingerprint(runner) {
    const type = runner.connection.options.type;
    if (type === 'sqljs')
        return hash({
            type,
            fixtureIdentity: runner.connection.options.name ?? 'test-order-cleanup-local-fixture',
        });
    assert.ok(
        ['mysql', 'mariadb'].includes(type),
        'Only an explicit MySQL/MariaDB target or SQLjs fixture is supported',
    );
    const [identity] = await runner.query(
        'SELECT DATABASE() AS databaseName, @@hostname AS hostName, @@port AS port, @@server_id AS serverId',
    );
    assert.ok(
        identity.databaseName && identity.hostName && identity.serverId != null,
        'Database identity is incomplete',
    );
    return hash({ type, ...identity });
}
const q = (runner, value) => runner.connection.driver.escape(value);
function predicate(runner, identity) {
    const parameters = [];
    const sql = Object.entries(identity)
        .map(([column, value]) => {
            if (value == null) return `${q(runner, column)} IS NULL`;
            parameters.push(value);
            return `${q(runner, column)} = ?`;
        })
        .join(' AND ');
    assert.ok(sql, 'An empty deletion identity is forbidden');
    return { sql, parameters };
}
async function readRows(runner, table, identities) {
    if (!identities.length) return [];
    const map = new Map();
    for (let offset = 0; offset < identities.length; offset += 100) {
        const parts = identities.slice(offset, offset + 100).map(identity => predicate(runner, identity));
        const select = table.columns
            .map(column =>
                ['mysql', 'mariadb'].includes(runner.connection.options.type) &&
                /date|time/u.test(table.columnTypes[column])
                    ? `CAST(${q(runner, column)} AS CHAR) AS ${q(runner, column)}`
                    : q(runner, column),
            )
            .join(',');
        const result = await runner.query(
            `SELECT ${select} FROM ${q(runner, table.name)} WHERE ${parts.map(part => `(${part.sql})`).join(' OR ')} LIMIT 20001`,
            parts.flatMap(part => part.parameters),
        );
        assert.ok(
            result.length <= 20000,
            'Graph exceeds bounded table page; narrow the reviewed frozen scope',
        );
        for (const row of result) map.set(rowKey(table, row), row);
    }
    return [...map.values()];
}

/** Collect all incoming order edges, including naked entity IDs, and needed baseline siblings. */
async function semanticReferenceQueries(runner, table, rows) {
    const queries = [];
    if (table.name === 'admin_notification_outbox') {
        for (const [sourceType, target] of Object.entries(notificationSources))
            for (const parent of rows[target] ?? [])
                queries.push({ sourceType, sourceId: valueKey(parent.id) });
        if (table.columns.includes('payload')) {
            const value = `CAST(JSON_EXTRACT(CASE WHEN JSON_VALID(${q(runner, 'payload')}) THEN ${q(runner, 'payload')} ELSE '{}' END, '$.orderId') AS CHAR)`;
            const expression = ['mysql', 'mariadb'].includes(runner.connection.options.type)
                ? `JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(${q(runner, 'payload')}) THEN ${q(runner, 'payload')} ELSE '{}' END, '$.orderId'))`
                : value;
            const ids = (rows.order ?? []).map(row => valueKey(row.id));
            for (let offset = 0; offset < ids.length; offset += 100) {
                const batch = ids.slice(offset, offset + 100);
                const found = await runner.query(
                    `SELECT ${q(runner, 'id')} FROM ${q(runner, table.name)} WHERE ${expression} IN (${batch.map(() => '?').join(',')}) LIMIT 20001`,
                    batch,
                );
                assert.ok(found.length <= 20000, 'Notification graph exceeds bounded page');
                queries.push(...found.map(row => ({ id: row.id })));
            }
        }
    }
    if (table.name === 'store_notification_read') {
        const prefixes = ['order', 'after_sales_request'].flatMap(target =>
            (rows[target] ?? []).map(row => `${target === 'order' ? 'ORDER' : 'AFTER_SALES'}:${row.id}:`),
        );
        for (let offset = 0; offset < prefixes.length; offset += 100) {
            const batch = prefixes.slice(offset, offset + 100);
            const found = await runner.query(
                `SELECT ${q(runner, 'id')} FROM ${q(runner, table.name)} WHERE ${batch.map(() => `SUBSTR(${q(runner, 'eventKey')},1,?) = ?`).join(' OR ')} LIMIT 20001`,
                batch.flatMap(prefix => [prefix.length, prefix]),
            );
            assert.ok(found.length <= 20000, 'Notification-read graph exceeds bounded page');
            queries.push(...found.map(row => ({ id: row.id })));
        }
    }
    return queries;
}

export async function collectCleanupSnapshot(runner, freeze, original) {
    const targetFingerprint = await databaseFingerprint(runner);
    assert.equal(targetFingerprint, freeze.targetFingerprint, 'Wrong database instance');
    const tables = (await runner.getTables())
        .map(table => ({
            name: table.name,
            columns: table.columns.map(column => column.name),
            columnTypes: Object.fromEntries(table.columns.map(column => [column.name, String(column.type)])),
            columnDefinitions: table.columns.map(column => ({
                name: column.name,
                type: String(column.type),
                length: column.length,
                precision: column.precision ?? null,
                scale: column.scale ?? null,
                unsigned: column.unsigned,
                nullable: column.isNullable,
                generated: column.isGenerated,
                generationStrategy: column.generationStrategy ?? null,
                default: column.default ?? null,
                onUpdate: column.onUpdate ?? null,
            })),
            primaryKeys: table.primaryColumns.map(column => column.name),
            foreignKeys: table.foreignKeys.map(key => ({
                columns: key.columnNames,
                target: key.referencedTableName,
                targetColumns: key.referencedColumnNames,
                onDelete: key.onDelete ?? null,
                onUpdate: key.onUpdate ?? null,
            })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const rows = Object.fromEntries(tables.map(table => [table.name, []]));
    const schemas = new Map(tables.map(table => [table.name, table]));
    assert.ok(schemas.has('order'), 'Order table absent');
    // Frozen scope covers all current orders. Reading only order IDs/cutoff also exposes additions during the freeze.
    const orderTable = schemas.get('order');
    const allIds = await runner.query(`SELECT ${q(runner, 'id')} FROM ${q(runner, 'order')} LIMIT 10001`);
    assert.ok(allIds.length <= 10000, 'Frozen scope exceeds 10000 orders');
    rows.order = (
        await readRows(
            runner,
            orderTable,
            allIds.map(row => ({ id: row.id })),
        )
    ).sort((a, b) => rowKey(orderTable, a).localeCompare(rowKey(orderTable, b)));
    let changed = true;
    let rounds = 0;
    while (changed) {
        assert.ok(++rounds <= 30, 'Graph traversal did not converge');
        changed = false;
        for (const table of tables) {
            if (table.name === 'order') continue;
            const queries = [];
            for (const ref of references(table))
                if (derived.has(ref.target))
                    for (const parent of rows[ref.target] ?? [])
                        queries.push(
                            Object.fromEntries(
                                ref.columns.map((column, index) => [
                                    column,
                                    parent[ref.targetColumns[index]],
                                ]),
                            ),
                        );
            // Recover outgoing baseline rows (warehouse levels are matched by SKU + location below).
            if (
                retained.has(table.name) ||
                ['fulfillment', 'referral_withdrawal', 'referral_ledger_entry'].includes(table.name)
            )
                for (const childTable of tables)
                    for (const ref of references(childTable))
                        if (ref.target === table.name)
                            for (const child of rows[childTable.name] ?? [])
                                if (ref.columns.every(column => child[column] != null))
                                    queries.push(
                                        Object.fromEntries(
                                            ref.targetColumns.map((column, index) => [
                                                column,
                                                child[ref.columns[index]],
                                            ]),
                                        ),
                                    );
            if (
                ['customer_service_review', 'customer_service_feedback'].includes(table.name) &&
                table.columns.includes('orderCode')
            )
                for (const order of rows.order)
                    if (order.code != null) queries.push({ orderCode: order.code });
            if (
                table.name === 'governance_audit_entry' &&
                table.columns.includes('resourceType') &&
                table.columns.includes('resourceId')
            ) {
                for (const item of rows.auto_card_pool_item ?? [])
                    queries.push({ resourceType: 'AutoCardPoolItem', resourceId: valueKey(item.id) });
                for (const delivery of rows.auto_card_delivery ?? [])
                    queries.push({ resourceType: 'AutoCardDelivery', resourceId: valueKey(delivery.id) });
            }
            const walletIds = rows.referral_wallet?.map(row => row.id) ?? [];
            if (
                ['referral_withdrawal', 'referral_ledger_entry', 'referral_wallet_usage'].includes(table.name)
            )
                for (const walletId of walletIds)
                    if (table.columns.includes('walletId')) queries.push({ walletId });
            if (table.name === 'stock_level')
                for (const move of rows.stock_movement ?? [])
                    queries.push({
                        productVariantId: move.productVariantId,
                        stockLocationId: move.stockLocationId,
                    });
            if (table.name === 'catalog_inventory_lot')
                for (const move of rows.catalog_inventory_lot_movement ?? [])
                    queries.push({ id: move.lotId });
            if (['customer_operations_profile', 'referral_wallet_usage'].includes(table.name))
                for (const order of rows.order)
                    if (order.customerId != null && table.columns.includes('customerId'))
                        queries.push({ customerId: order.customerId });
            if (table.name === 'auto_card_pool_item')
                for (const reservation of rows.digital_order_reservation ?? []) {
                    const ids = metadataJson(reservation.poolItemIdsJson);
                    if (Array.isArray(ids)) ids.forEach(id => queries.push({ id }));
                }
            if (original)
                for (const row of original.rows[table.name] ?? [])
                    queries.push(
                        Object.fromEntries(
                            (table.primaryKeys.length ? table.primaryKeys : table.columns).map(column => [
                                column,
                                row[column],
                            ]),
                        ),
                    );
            queries.push(...(await semanticReferenceQueries(runner, table, rows)));
            if (!queries.length) continue;
            const found = await readRows(runner, table, queries);
            const map = new Map(rows[table.name].map(row => [rowKey(table, row), row]));
            for (const row of found) {
                const key = rowKey(table, row);
                if (!map.has(key)) {
                    map.set(key, row);
                    changed = true;
                }
            }
            rows[table.name] = [...map.values()].sort((a, b) =>
                rowKey(table, a).localeCompare(rowKey(table, b)),
            );
        }
    }
    return { targetFingerprint, tables, rows };
}

function verifyPostState(snapshot, plan) {
    if ((snapshot.rows.order ?? []).length) return false;
    const tables = new Map(snapshot.tables.map(table => [table.name, table]));
    return (
        plan.deletes.every(
            item =>
                !(snapshot.rows[item.table] ?? []).some(
                    row => rowKey(tables.get(item.table), row) === item.key,
                ),
        ) &&
        plan.patches.every(patch => {
            const row = (snapshot.rows[patch.table] ?? []).find(
                item => rowKey(tables.get(patch.table), item) === patch.key,
            );
            return (
                row &&
                Object.keys(patch.after)
                    .filter(key => !equal(patch.before[key], patch.after[key]))
                    .every(key => equal(row[key], patch.after[key]))
            );
        })
    );
}

function expectedPostSnapshot(backup, plan) {
    return {
        ...backup,
        rows: Object.fromEntries(
            backup.tables.map(table => [
                table.name,
                backup.rows[table.name]
                    .filter(
                        row =>
                            !plan.deletes.some(
                                item => item.table === table.name && item.key === rowKey(table, row),
                            ),
                    )
                    .map(
                        row =>
                            plan.patches.find(
                                patch => patch.table === table.name && patch.key === rowKey(table, row),
                            )?.after ?? row,
                    ),
            ]),
        ),
    };
}

/** Local operator-only transaction. Never calls payment gateways or chain clients. */
export async function applyCleanup(runner, envelope, expectedBackupHash, expectedPlanHash, key) {
    const { snapshot: backup, freeze, plan } = openBackup(envelope, expectedBackupHash, key);
    assert.equal(plan.planHash, expectedPlanHash, 'Reviewed plan hash mismatch');
    assert.ok(
        !plan.blockers.length && !plan.gates.length,
        'Unexplained data impacts or unverified freeze gates',
    );
    assert.equal(runner.isTransactionActive, false, 'Cleanup owns its transaction');
    await runner.startTransaction('SERIALIZABLE');
    try {
        if (['mysql', 'mariadb'].includes(runner.connection.options.type))
            await runner.query(
                `SELECT id FROM ${q(runner, 'order')} WHERE id IN (${freeze.orderIds.map(() => '?').join(',')}) FOR UPDATE`,
                freeze.orderIds,
            );
        const current = await collectCleanupSnapshot(runner, freeze, backup);
        if (verifyPostState(current, plan)) {
            assert.equal(
                hash(current),
                hash(expectedPostSnapshot(backup, plan)),
                'Post-cleanup drift; refuse repeat execution',
            );
            await runner.commitTransaction();
            return cleanupReceipt('ALREADY_APPLIED', current, plan, expectedBackupHash);
        }
        assert.equal(
            hash(current),
            plan.snapshotHash,
            'Data or schema drift after frozen backup; regenerate the preview and backup',
        );
        for (const patch of plan.patches) {
            const values = Object.fromEntries(
                Object.keys(patch.after)
                    .filter(column => !equal(patch.before[column], patch.after[column]))
                    .map(column => [column, patch.after[column]]),
            );
            if (!Object.keys(values).length) continue;
            // MySQL ON UPDATE timestamps must not introduce an unplanned post-state.
            if (Object.hasOwn(patch.before, 'updatedAt')) values.updatedAt = patch.before.updatedAt;
            const where = predicate(runner, patch.identity);
            await runner.query(
                `UPDATE ${q(runner, patch.table)} SET ${Object.keys(values)
                    .map(column => `${q(runner, column)} = ?`)
                    .join(',')} WHERE ${where.sql}`,
                [...Object.values(values), ...where.parameters],
            );
        }
        for (const table of plan.deleteOrder)
            for (const item of plan.deletes.filter(row => row.table === table)) {
                const where = predicate(runner, item.identity);
                await runner.query(`DELETE FROM ${q(runner, table)} WHERE ${where.sql}`, where.parameters);
            }
        const after = await collectCleanupSnapshot(runner, freeze, backup);
        assert.ok(verifyPostState(after, plan), 'Post-delete graph or restored baseline verification failed');
        await runner.commitTransaction();
        return cleanupReceipt('APPLIED', after, plan, expectedBackupHash);
    } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
    }
}

function cleanupReceipt(status, snapshot, plan, backupHash) {
    const receipt = {
        version: 1,
        status,
        targetFingerprint: plan.targetFingerprint,
        backupHash,
        planHash: plan.planHash,
        postSnapshotHash: hash(snapshot),
        deletedRows: plan.deletes.length,
        restoredBaselines: plan.patches.length,
        externalActions: [],
    };
    return { ...receipt, receiptHash: hash(receipt) };
}

/** Recovery is a second isolated transaction, only while the exact committed post-state is frozen. */
export async function restoreCleanup(
    runner,
    envelope,
    expectedBackupHash,
    expectedPlanHash,
    key,
    receipt,
    expectedReceiptHash,
) {
    const { snapshot: backup, freeze, plan } = openBackup(envelope, expectedBackupHash, key);
    assert.equal(plan.planHash, expectedPlanHash, 'Reviewed restore plan mismatch');
    const { receiptHash, ...body } = receipt;
    assert.equal(hash(body), expectedReceiptHash, 'Restore receipt hash mismatch');
    assert.equal(receiptHash, expectedReceiptHash);
    assert.ok(
        ['APPLIED', 'ALREADY_APPLIED'].includes(receipt.status),
        'A committed cleanup receipt is required',
    );
    assert.equal(receipt.planHash, plan.planHash);
    assert.equal(receipt.backupHash, expectedBackupHash);
    assert.equal(receipt.targetFingerprint, freeze.targetFingerprint);
    assert.equal(runner.isTransactionActive, false);
    await runner.startTransaction('SERIALIZABLE');
    try {
        const current = await collectCleanupSnapshot(runner, freeze, backup);
        if (hash(current) === plan.snapshotHash) {
            await runner.commitTransaction();
            return { status: 'ALREADY_RESTORED', planHash: plan.planHash, externalActions: [] };
        }
        assert.equal(
            hash(current),
            receipt.postSnapshotHash,
            'Post-cleanup drift; refuse overwriting resumed business data',
        );
        assert.ok(verifyPostState(current, plan), 'Cleanup post-state is incomplete');
        for (const table of [...plan.deleteOrder].reverse())
            for (const item of plan.deletes.filter(record => record.table === table).reverse()) {
                const schema = backup.tables.find(record => record.name === table);
                const row = backup.rows[table].find(record => rowKey(schema, record) === item.key);
                const columns = Object.keys(row);
                await runner.query(
                    `INSERT INTO ${q(runner, table)} (${columns.map(column => q(runner, column)).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
                    columns.map(column => row[column]),
                );
            }
        for (const patch of plan.patches) {
            const where = predicate(runner, patch.identity);
            const columns = Object.keys(patch.before).filter(
                column => !Object.hasOwn(patch.identity, column),
            );
            await runner.query(
                `UPDATE ${q(runner, patch.table)} SET ${columns.map(column => `${q(runner, column)} = ?`).join(',')} WHERE ${where.sql}`,
                [...columns.map(column => patch.before[column]), ...where.parameters],
            );
        }
        const restored = await collectCleanupSnapshot(runner, freeze, backup);
        assert.equal(hash(restored), plan.snapshotHash, 'Backup recovery verification failed');
        await runner.commitTransaction();
        return {
            status: 'RESTORED',
            planHash: plan.planHash,
            restoredSnapshotHash: hash(restored),
            externalActions: [],
        };
    } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
    }
}

async function artifactPath(value) {
    const absolute = path.resolve(value);
    assert.ok(
        absolute.startsWith(root + path.sep) && absolute.includes(`${path.sep}artifacts${path.sep}`),
        'Artifacts must remain inside this project artifacts directory',
    );
    await mkdir(path.dirname(absolute), { recursive: true });
    const projectPath = await realpath(root);
    const parentPath = await realpath(path.dirname(absolute));
    assert.ok(parentPath.startsWith(projectPath + path.sep), 'Artifact symlink escapes the project');
    return absolute;
}

async function writeReceipt(handle, value) {
    const buffer = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    await handle.truncate(0);
    let written = 0;
    while (written < buffer.length) {
        const result = await handle.write(buffer, written, buffer.length - written, written);
        assert.ok(result.bytesWritten > 0, 'Receipt write made no progress');
        written += result.bytesWritten;
    }
    await handle.sync();
}

/** Preflight persistence before mutation; a committed result is never reported as a rollback. */
export async function executeWithReceipt(handle, binding, execute) {
    await writeReceipt(handle, { version: 1, status: 'EXECUTION_PENDING', ...binding });
    const receipt = await execute();
    try {
        await writeReceipt(handle, receipt);
        return { status: receipt.status, receiptArtifact: 'SAVED', receipt };
    } catch {
        // The safe stdout receipt remains sufficient for verified encrypted-backup recovery.
        return { status: receipt.status, receiptArtifact: 'WRITE_FAILED_RETAIN_STDOUT_RECEIPT', receipt };
    }
}

/** Reading a candidate scope does not establish which rows are verified test orders. */
export function createFrozenCandidate(targetFingerprint, cutoff, orderIds) {
    return {
        version: 1,
        targetFingerprint,
        cutoff,
        orderIds,
        allOrdersAtCutoffAreTest: false,
        writersPaused: false,
        queuesPaused: false,
        freezeEvidenceHash: null,
        trackingByVariant: {},
    };
}

async function main(argv, environment) {
    const args = Object.fromEntries(argv.map(arg => arg.split('=')));
    args['--mode'] ??= 'preview';
    assert.ok(
        ['freeze', 'preview', 'backup', 'apply', 'restore'].includes(args['--mode']),
        'Choose explicit --mode=freeze|preview|backup|apply|restore',
    );
    const runtime = createRequire(import.meta.url);
    const { DataSource } = runtime('typeorm');
    for (const name of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME'])
        assert.ok(
            Object.hasOwn(environment, `TEST_ORDER_CLEANUP_DB_${name}`),
            `Explicit TEST_ORDER_CLEANUP_DB_${name} required; no guessed connection defaults`,
        );
    const database = new DataSource({
        type: 'mysql',
        host: environment.TEST_ORDER_CLEANUP_DB_HOST,
        port: Number(environment.TEST_ORDER_CLEANUP_DB_PORT),
        username: environment.TEST_ORDER_CLEANUP_DB_USER,
        password: environment.TEST_ORDER_CLEANUP_DB_PASSWORD,
        database: environment.TEST_ORDER_CLEANUP_DB_NAME,
        entities: [],
        synchronize: false,
        logging: false,
        timezone: 'Z',
        extra: { dateStrings: true },
    });
    await database.initialize();
    const runner = database.createQueryRunner();
    try {
        if (args['--mode'] === 'freeze') {
            assert.ok(args['--cutoff'] && args['--out']);
            assert.ok(Number.isFinite(Date.parse(args['--cutoff'])), 'Explicit valid cutoff required');
            const orderIds = (
                await runner.query('SELECT id FROM `order` WHERE createdAt <= ? ORDER BY id', [
                    new Date(args['--cutoff']),
                ])
            ).map(row => String(row.id));
            const recordedScope = createFrozenCandidate(
                await databaseFingerprint(runner),
                args['--cutoff'],
                orderIds,
            );
            await writeFile(await artifactPath(args['--out']), JSON.stringify(recordedScope, null, 2), {
                mode: 0o600,
                flag: 'wx',
            });
            return {
                status: 'FROZEN_SCOPE_RECORDED',
                orderCount: orderIds.length,
                targetFingerprint: recordedScope.targetFingerprint,
                execution: 'HOLD_PENDING_FREEZE_EVIDENCE',
            };
        }
        const freeze = JSON.parse(await readFile(args['--freeze'], 'utf8'));
        const key = Buffer.from(environment.TEST_ORDER_CLEANUP_BACKUP_KEY ?? '', 'base64');
        let envelope;
        if (['apply', 'restore'].includes(args['--mode'])) {
            assert.ok(args['--backup'] && args['--backup-hash'] && args['--plan-hash']);
            envelope = JSON.parse(await readFile(args['--backup'], 'utf8'));
            const verified = openBackup(envelope, args['--backup-hash'], key);
            assert.ok(equal(freeze, verified.freeze), 'Reviewed frozen scope differs from encrypted backup');
            assert.equal(args['--target-fingerprint'], freeze.targetFingerprint, 'Explicit target required');
            assert.equal(args['--cutoff'], freeze.cutoff, 'Explicit frozen cutoff required');
            assert.equal(
                args['--order-set-hash'],
                digest(freeze.orderIds.map(String).sort()),
                'Explicit frozen order-set hash required',
            );
            assert.equal(
                args['--pause-evidence-hash'],
                freeze.freezeEvidenceHash,
                'Reviewed writer and queue pause evidence required',
            );
        }
        if (args['--mode'] === 'restore') {
            assert.ok(
                args['--backup'] &&
                    args['--backup-hash'] &&
                    args['--plan-hash'] &&
                    args['--receipt'] &&
                    args['--receipt-hash'],
            );
            return await restoreCleanup(
                runner,
                envelope,
                args['--backup-hash'],
                args['--plan-hash'],
                key,
                JSON.parse(await readFile(args['--receipt'], 'utf8')),
                args['--receipt-hash'],
            );
        }
        if (args['--mode'] === 'apply') {
            assert.ok(args['--out']);
            const receiptPath = await artifactPath(args['--out']);
            const handle = await open(receiptPath, 'wx', 0o600);
            try {
                return await executeWithReceipt(
                    handle,
                    {
                        targetFingerprint: freeze.targetFingerprint,
                        backupHash: args['--backup-hash'],
                        planHash: args['--plan-hash'],
                    },
                    () => applyCleanup(runner, envelope, args['--backup-hash'], args['--plan-hash'], key),
                );
            } finally {
                await handle.close().catch(() => undefined);
            }
        }
        await runner.startTransaction('REPEATABLE READ');
        try {
            const snapshot = await collectCleanupSnapshot(runner, freeze);
            const plan = buildCleanupPlan(snapshot, freeze);
            const preview = publicCleanupPreview(plan);
            if (args['--mode'] === 'backup') {
                const sealed = sealBackup(snapshot, freeze, plan, key);
                assert.ok(args['--out']);
                await writeFile(await artifactPath(args['--out']), JSON.stringify(sealed.envelope), {
                    mode: 0o600,
                    flag: 'wx',
                });
                preview.backupHash = sealed.backupHash;
            }
            await runner.rollbackTransaction();
            return preview;
        } catch (error) {
            if (runner.isTransactionActive) await runner.rollbackTransaction();
            throw error;
        }
    } finally {
        await runner.release();
        await database.destroy();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2), process.env)
        .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
        .catch(() => {
            process.stderr.write(
                'Cleanup stopped. Check target identity, graph blockers, freeze evidence and reviewed backup hashes. No gateway or chain action was performed.\n',
            );
            process.exitCode = 1;
        });
