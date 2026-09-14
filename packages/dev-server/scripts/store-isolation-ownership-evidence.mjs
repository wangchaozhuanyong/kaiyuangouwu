import { createHmac } from 'node:crypto';
import path from 'node:path';

import {
    collectCustomerDependencies,
    redactCustomerDependencies,
} from './store-isolation-customer-dependencies.mjs';

// Explicit columns only: never select credentials, invite codes, payment metadata or payout accounts.
const CUSTOMER_RELATIONS = [
    ['referral_account', ['customerId'], ['channelId']],
    [
        'referral_wallet',
        ['customerId'],
        [
            'channelId',
            'referralAccountId',
            'currencyCode',
            'availableBalance',
            'pendingBalance',
            'reservedBalance',
        ],
    ],
    [
        'referral_ledger_entry',
        ['customerId'],
        [
            'channelId',
            'walletId',
            'currencyCode',
            'orderId',
            'refundId',
            'withdrawalId',
            'availableDelta',
            'pendingDelta',
            'reservedDelta',
            'availableAfter',
            'pendingAfter',
            'reservedAfter',
        ],
    ],
    ['referral_relationship', ['inviterCustomerId', 'inviteeCustomerId'], ['channelId']],
    [
        'referral_reward',
        ['inviterCustomerId', 'inviteeCustomerId'],
        [
            'channelId',
            'orderId',
            'currencyCode',
            'rewardAmount',
            'releasedAmount',
            'clawedBackAmount',
            'status',
        ],
    ],
    [
        'referral_balance_use',
        ['customerId'],
        ['channelId', 'walletId', 'orderId', 'currencyCode', 'amount', 'refundedAmount', 'status'],
    ],
    [
        'referral_wallet_usage',
        ['customerId'],
        ['channelId', 'walletId', 'currencyCode', 'amount', 'capturedAmount', 'releasedAmount', 'status'],
    ],
    ['referral_withdrawal', ['customerId'], ['channelId', 'walletId', 'currencyCode', 'amount', 'status']],
];

const REFERENCE_TYPES = {
    customerId: 'customers',
    inviterCustomerId: 'customers',
    inviteeCustomerId: 'customers',
    userId: 'user',
    orderId: 'order',
    orderLineId: 'order_line',
    productVariantId: 'productVariants',
    productId: 'products',
    stockLocationId: 'stockLocations',
    walletId: 'referral_wallet',
    referralAccountId: 'referral_account',
    refundId: 'refund',
    withdrawalId: 'referral_withdrawal',
    ownerId: 'user',
    roleId: 'role',
    apiKeyId: 'api_key',
    customerGroupId: 'customer_group',
    administratorId: 'administrator',
    customerCouponId: 'customer_coupon',
    campaignConfigId: 'store_coupon_campaign_config',
    promotionId: 'promotion',
    lockedOrderId: 'order',
    usedOrderId: 'order',
    activeOrderId: 'order',
};

const MONEY_COLUMNS = /(?:Balance|Delta|After|Amount)$|^(amount|rewardAmount)$/u;

function quote(value) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(value)) throw new Error('Unsafe inventory identifier');
    return `\`${value}\``;
}

function placeholders(values) {
    return values.map(() => '?').join(', ');
}

async function hasColumns(adapter, table, columns) {
    if (!(await adapter.tableExists(table))) return false;
    for (const column of columns) if (!(await adapter.columnExists(table, column))) return false;
    return true;
}

async function rowsFor(adapter, table, selectors, fields, ids) {
    const columns = [...new Set(['id', ...selectors, ...fields])];
    if (!(await hasColumns(adapter, table, columns))) return { available: false, rows: [] };
    if (!ids.length) return { available: true, rows: [] };
    const where = selectors.map(field => `${quote(field)} IN (${placeholders(ids)})`).join(' OR ');
    const rows = await adapter.query(
        `SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)} WHERE ${where} ORDER BY id`,
        selectors.flatMap(() => ids),
    );
    return { available: true, rows };
}

async function orderChannels(adapter, orderIds) {
    if (!(await hasColumns(adapter, 'order_channels_channel', ['orderId', 'channelId'])))
        return { available: false, rows: [] };
    if (!orderIds.length) return { available: true, rows: [] };
    return {
        available: true,
        rows: await adapter.query(
            `SELECT orderId, channelId FROM order_channels_channel WHERE orderId IN (${placeholders(orderIds)}) ORDER BY orderId, channelId`,
            orderIds,
        ),
    };
}

function channelIdsFor(rows, id) {
    return [
        ...new Set(rows.filter(row => String(row.orderId) === String(id)).map(row => String(row.channelId))),
    ].sort();
}

async function customerEvidence(adapter, ids) {
    const login = await rowsFor(adapter, 'customer', ['id'], ['userId'], ids);
    const addresses = await rowsFor(adapter, 'address', ['customerId'], [], ids);
    // Order addresses are snapshots, not Address foreign keys. Collect references only;
    // do not treat an address count as evidence that copying it between stores is allowed.
    const orders = await rowsFor(adapter, 'order', ['customerId'], [], ids);
    const channels = await orderChannels(
        adapter,
        orders.rows.map(row => row.id),
    );
    orders.available = orders.available && channels.available;
    for (const row of orders.rows) row.channelIds = channelIdsFor(channels.rows, row.id);
    const relations = {};
    for (const [table, selectors, fields] of CUSTOMER_RELATIONS) {
        relations[table] = await rowsFor(adapter, table, selectors, fields, ids);
    }
    const walletIds = relations.referral_wallet.rows.map(row => row.id);
    for (const [table, selectors, fields] of CUSTOMER_RELATIONS.filter(item =>
        item[2].includes('walletId'),
    )) {
        const linked = await rowsFor(adapter, table, ['walletId'], [...selectors, ...fields], walletIds);
        relations[table].available = relations[table].available && linked.available;
        const merged = new Map(relations[table].rows.map(row => [String(row.id), row]));
        for (const row of linked.rows) merged.set(String(row.id), row);
        relations[table].rows = [...merged.values()];
    }
    const dependencies = await collectCustomerDependencies(
        adapter,
        ids,
        [...new Set(login.rows.map(row => row.userId).filter(id => id != null))],
        (table, selectors, fields, selectedIds) => rowsFor(adapter, table, selectors, fields, selectedIds),
        orders,
    );
    return { login, addresses, orders, relations, dependencies };
}

async function stockEvidence(adapter, ids) {
    const levels = await rowsFor(
        adapter,
        'stock_level',
        ['stockLocationId'],
        ['productVariantId', 'stockOnHand', 'stockAllocated'],
        ids,
    );
    const movements = await rowsFor(
        adapter,
        'stock_movement',
        ['stockLocationId'],
        ['productVariantId', 'orderLineId', 'type', 'quantity'],
        ids,
    );
    const lineIds = [...new Set(movements.rows.map(row => row.orderLineId).filter(id => id != null))];
    const lines = await rowsFor(adapter, 'order_line', ['id'], ['orderId'], lineIds);
    const channels = await orderChannels(
        adapter,
        lines.rows.map(row => row.orderId),
    );
    movements.available = movements.available && lines.available && channels.available;
    for (const row of movements.rows) {
        const line = lines.rows.find(item => String(item.id) === String(row.orderLineId));
        row.orderId = line?.orderId ?? null;
        row.channelIds = channelIdsFor(channels.rows, row.orderId);
    }
    return { levels, movements };
}

async function configurationEvidence(adapter, associations) {
    const result = [];
    for (const [resource, table, fields, historyTable, historyKey] of [
        ['paymentMethods', 'payment_method', ['code', 'enabled', 'checker', 'handler'], 'payment', 'method'],
        [
            'shippingMethods',
            'shipping_method',
            ['code', 'checker', 'calculator', 'fulfillmentHandlerCode'],
            'shipping_line',
            'shippingMethodId',
        ],
    ]) {
        const configurations = await rowsFor(
            adapter,
            table,
            ['id'],
            fields,
            associations[resource].shared.map(item => item.entityId),
        );
        for (const item of associations[resource].shared) {
            const config = configurations.rows.find(row => String(row.id) === String(item.entityId));
            const lookup = resource === 'paymentMethods' ? config?.code : item.entityId;
            // Payment.method refers to a code, ShippingLine.shippingMethodId refers to an ID.
            const history = await rowsFor(
                adapter,
                historyTable,
                [historyKey],
                ['orderId'],
                lookup == null ? [] : [lookup],
            );
            history.available = history.available && lookup != null;
            const channels = await orderChannels(
                adapter,
                history.rows.map(row => row.orderId),
            );
            history.available = history.available && channels.available;
            for (const row of history.rows) {
                delete row[historyKey];
                row.channelIds = channelIdsFor(channels.rows, row.orderId);
            }
            result.push({
                resource,
                entityId: item.entityId,
                configuration: config ?? null,
                historyTable,
                history,
            });
        }
    }
    return result;
}

async function digitalEvidence(adapter, files) {
    const result = [];
    for (const file of files) {
        const sku = path.basename(file.name, path.extname(file.name));
        const variants = await rowsFor(adapter, 'product_variant', ['sku'], ['productId'], [sku]);
        const variantIds = variants.rows.map(row => row.id);
        const lines = await rowsFor(adapter, 'order_line', ['productVariantId'], ['orderId'], variantIds);
        const channels = await orderChannels(
            adapter,
            lines.rows.map(row => row.orderId),
        );
        lines.available = lines.available && channels.available;
        for (const row of variants.rows) delete row.sku;
        for (const row of lines.rows) row.channelIds = channelIdsFor(channels.rows, row.orderId);
        result.push({ fileName: file.name, variants, lines });
    }
    return result;
}

export async function collectOwnershipEvidence(adapter, associations, files) {
    return {
        customers: await customerEvidence(
            adapter,
            associations.customers.shared.map(item => item.entityId),
        ),
        stock: await stockEvidence(
            adapter,
            associations.stockLocations.shared.map(item => item.entityId),
        ),
        configuration: await configurationEvidence(adapter, associations),
        digital: await digitalEvidence(adapter, files),
    };
}

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

function configFingerprint(config, auditKey) {
    if (!config) return null;
    const { id, ...fields } = config;
    for (const field of ['checker', 'handler', 'calculator']) {
        if (typeof fields[field] === 'string') {
            try {
                fields[field] = JSON.parse(fields[field]);
            } catch {
                throw new Error('Invalid configuration JSON; inventory stopped');
            }
        }
    }
    return createHmac('sha256', auditKey)
        .update(JSON.stringify(canonical(fields)))
        .digest('hex');
}

export function redactOwnershipEvidence(evidence, reference, auditKey) {
    if (!evidence) return null;
    const redact = (table, row) =>
        Object.fromEntries(
            Object.entries(row).map(([key, value]) => {
                if (key === 'id') return ['entityRef', reference(table, value)];
                if (REFERENCE_TYPES[key])
                    return [
                        key.replace(/Id$/u, 'Ref'),
                        value == null ? null : reference(REFERENCE_TYPES[key], value),
                    ];
                if (key === 'channelId') return [key, value == null ? null : String(value)];
                if (key === 'activeChannelId') return [key, value == null ? null : String(value)];
                if (['verified', 'invalidated', 'isDefault', 'isPublic'].includes(key)) {
                    if (![true, false, 0, 1, '0', '1'].includes(value))
                        throw new Error('Invalid dependency boolean');
                    return [key, Number(value) === 1];
                }
                if (
                    MONEY_COLUMNS.test(key) ||
                    ['stockOnHand', 'stockAllocated', 'quantity', 'visitCount'].includes(key)
                ) {
                    if (value == null || !Number.isSafeInteger(Number(value)))
                        throw new Error('Unsafe inventory quantity');
                    return [key, Number(value)];
                }
                return [key, value];
            }),
        );
    const group = (table, item) => ({
        available: item.available,
        rows: item.rows.map(row => redact(table, row)),
    });
    return {
        format: 1,
        referenceScope: 'this-preflight-only',
        customers: {
            login: group('customers', evidence.customers.login),
            addresses: group('address', evidence.customers.addresses),
            orders: group('order', evidence.customers.orders),
            relations: Object.fromEntries(
                Object.entries(evidence.customers.relations).map(([table, item]) => [
                    table,
                    group(table, item),
                ]),
            ),
            dependencies: redactCustomerDependencies(evidence.customers.dependencies, group, reference),
        },
        stock: {
            levels: group('stock_level', evidence.stock.levels),
            movements: group('stock_movement', evidence.stock.movements),
        },
        configuration: evidence.configuration.map(item => ({
            resource: item.resource,
            entityRef: reference(item.resource, item.entityId),
            configurationFingerprint: configFingerprint(item.configuration, auditKey),
            fingerprintScope: 'this-preflight-only',
            history: group(item.historyTable, item.history),
        })),
        digital: evidence.digital.map(item => ({
            fileRef: reference('digitalDeliveryFile', item.fileName),
            variants: group('productVariants', item.variants),
            lines: group('order_line', item.lines),
        })),
    };
}
