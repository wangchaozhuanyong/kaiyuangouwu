import { createHmac, randomBytes } from 'node:crypto';

const BUSINESS = [
    ['customer_delivery_email', ['channelId', 'isDefault']],
    ['after_sales_request', ['channelId', 'orderId', 'refundId']],
    [
        'customer_coupon',
        ['channelId', 'promotionId', 'campaignConfigId', 'lockedOrderId', 'usedOrderId', 'status'],
    ],
    [
        'coupon_ledger_entry',
        ['channelId', 'customerCouponId', 'promotionId', 'orderId', 'refundId', 'eventType'],
    ],
    [
        'coupon_order_allocation',
        ['channelId', 'customerCouponId', 'promotionId', 'orderId', 'refundId', 'status'],
    ],
    ['storefront_daily_visitor', ['channelId', 'visitCount']],
    ['history_entry', ['orderId', 'administratorId', 'type', 'isPublic']],
];

export const CUSTOMER_DEPENDENCY_GROUPS = [
    ...BUSINESS.map(([table]) => table),
    'customer_groups_customer_group',
    'customer_group',
    'user',
    'authentication_method',
    'administrator',
    'session',
    'api_key',
    'api_key_channels_channel',
    'user_roles_role',
    'role',
    'role_channels_channel',
    'related_order',
];

const ADDRESS_FIELDS = [
    'fullName',
    'company',
    'streetLine1',
    'streetLine2',
    'city',
    'province',
    'postalCode',
    'phoneNumber',
];
const KNOWN_EDGES = new Set([
    ...BUSINESS.map(([table]) => `${table}.customerId:customer`),
    ...[
        'referral_account',
        'referral_wallet',
        'referral_ledger_entry',
        'referral_balance_use',
        'referral_wallet_usage',
        'referral_withdrawal',
    ].map(table => `${table}.customerId:customer`),
    ...['referral_relationship', 'referral_reward'].flatMap(table =>
        ['inviterCustomerId', 'inviteeCustomerId'].map(column => `${table}.${column}:customer`),
    ),
    'customer.userId:user',
    'customer_channels_channel.customerId:customer',
    'address.customerId:customer',
    'order.customerId:customer',
    'customer_groups_customer_group.customerId:customer',
    'authentication_method.userId:user',
    'administrator.userId:user',
    'session.userId:user',
    'api_key.userId:user',
    'api_key.ownerId:user',
    'user_roles_role.userId:user',
]);

function quote(name) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(name)) throw new Error('Unsafe dependency schema identifier');
    return `\`${name}\``;
}

async function columnsAvailable(adapter, table, columns) {
    if (!(await adapter.tableExists(table))) return false;
    for (const column of columns) if (!(await adapter.columnExists(table, column))) return false;
    return true;
}

async function joinRows(adapter, table, selector, fields, ids) {
    const columns = [selector, ...fields];
    if (!(await columnsAvailable(adapter, table, columns))) return { available: false, rows: [] };
    if (!ids.length) return { available: true, rows: [] };
    const rows = await adapter.query(
        `SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)} WHERE ${quote(selector)} IN (${ids.map(() => '?').join(', ')})`,
        ids,
    );
    return {
        available: true,
        rows: rows.map(row => ({ ...row, id: JSON.stringify(columns.map(column => row[column])) })),
    };
}

export async function collectCustomerRelationSchema(adapter) {
    let columns;
    let foreignKeys;
    if (adapter.kind === 'mysql') {
        columns =
            await adapter.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType
            FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
        foreignKeys = await adapter.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS targetTable, REFERENCED_COLUMN_NAME AS targetColumn
            FROM information_schema.key_column_usage WHERE TABLE_SCHEMA = DATABASE()
            AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, COLUMN_NAME`);
    } else if (adapter.kind === 'sqlite') {
        columns = [];
        foreignKeys = [];
        const tables = await adapter.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        for (const { name } of tables) {
            for (const column of await adapter.query(`PRAGMA table_info(${quote(name)})`))
                columns.push({ tableName: name, columnName: column.name, dataType: column.type });
            for (const fk of await adapter.query(`PRAGMA foreign_key_list(${quote(name)})`))
                foreignKeys.push({
                    tableName: name,
                    columnName: fk.from,
                    targetTable: fk.table,
                    targetColumn: fk.to,
                });
        }
    } else return { available: false, edges: [], opaqueColumns: [], softReferenceClosure: 'unproven' };
    const edges = new Map();
    for (const fk of foreignKeys) {
        if (!['customer', 'user', 'address'].includes(fk.targetTable)) continue;
        const key = `${fk.tableName}.${fk.columnName}:${fk.targetTable}`;
        edges.set(key, {
            ...fk,
            kind: 'foreign-key',
            handled: fk.targetColumn === 'id' && KNOWN_EDGES.has(key),
        });
    }
    for (const column of columns) {
        const target = column.columnName.match(/(customer|user|address)(?:Id|Ref)$/iu)?.[1].toLowerCase();
        if (!target) continue;
        const key = `${column.tableName}.${column.columnName}:${target}`;
        if (!edges.has(key))
            edges.set(key, {
                tableName: column.tableName,
                columnName: column.columnName,
                targetTable: target,
                kind: 'identifier-column',
                handled: KNOWN_EDGES.has(key),
            });
    }
    const opaqueColumns = columns
        .filter(
            column =>
                (/json/iu.test(column.dataType) ||
                    /^(data|metadata|customfields)/iu.test(column.columnName)) &&
                !(
                    column.tableName === 'order' &&
                    ['shippingAddress', 'billingAddress'].includes(column.columnName)
                ),
        )
        .map(({ tableName, columnName }) => ({ tableName, columnName }));
    return { available: true, edges: [...edges.values()], opaqueColumns, softReferenceClosure: 'unproven' };
}

function normalizeAddress(value) {
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return { reason: 'malformed-address-snapshot' };
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return { reason: 'invalid-address-snapshot' };
    if (!Object.keys(value).length) return { reason: 'empty-address-snapshot' };
    const allowed = [...ADDRESS_FIELDS, 'countryCode', 'country'];
    if (Object.keys(value).some(key => !allowed.includes(key)))
        return { reason: 'unreviewed-address-fields' };
    const normalized = {};
    for (const field of [...ADDRESS_FIELDS, 'countryCode']) {
        const part = value[field];
        if (part != null && typeof part !== 'string') return { reason: 'invalid-address-field-type' };
        normalized[field] = (part ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').trim();
    }
    if (!normalized.streetLine1 || !/^[A-Z]{2}$/u.test(normalized.countryCode))
        return { reason: 'incomplete-address-snapshot' };
    return { normalized };
}

async function addressMatches(adapter, customerIds, read) {
    const addresses = await read(
        'address',
        ['customerId'],
        [...ADDRESS_FIELDS, 'countryId', 'defaultShippingAddress', 'defaultBillingAddress'],
        customerIds,
    );
    const orders = await read('order', ['customerId'], ['shippingAddress', 'billingAddress'], customerIds);
    const regions = await read(
        'region',
        ['id'],
        ['code', 'type'],
        [...new Set(addresses.rows.map(row => row.countryId))],
    );
    const orderChannels = await joinRows(
        adapter,
        'order_channels_channel',
        'orderId',
        ['channelId'],
        orders.rows.map(row => row.id),
    );
    const available = addresses.available && orders.available && regions.available && orderChannels.available;
    const key = randomBytes(32);
    const digest = value => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
    const snapshots = [];
    const issues = [];
    for (const order of orders.rows) {
        for (const kind of ['shippingAddress', 'billingAddress']) {
            const parsed = normalizeAddress(order[kind]);
            if (parsed.normalized)
                snapshots.push({
                    orderId: order.id,
                    customerId: order.customerId,
                    kind,
                    fingerprint: digest(parsed.normalized),
                });
            else if (parsed.reason !== 'empty-address-snapshot')
                issues.push({ customerId: order.customerId, orderId: order.id, reason: parsed.reason });
        }
    }
    const rows = addresses.rows.map(address => {
        const country = regions.rows.find(
            row => String(row.id) === String(address.countryId) && row.type === 'country',
        );
        const input = Object.fromEntries(ADDRESS_FIELDS.map(field => [field, address[field]]));
        const parsed = normalizeAddress({ ...input, countryCode: country?.code });
        const fingerprint = parsed.normalized ? digest(parsed.normalized) : null;
        const matches = snapshots.filter(
            item =>
                fingerprint &&
                item.fingerprint === fingerprint &&
                String(item.customerId) === String(address.customerId),
        );
        const candidateChannelIds = [
            ...new Set(
                matches.flatMap(item =>
                    orderChannels.rows
                        .filter(row => String(row.orderId) === String(item.orderId))
                        .map(row => String(row.channelId)),
                ),
            ),
        ].sort();
        const reasons = [];
        if (!fingerprint) reasons.push(parsed.reason);
        if (!matches.length) reasons.push('address-owner-unresolved');
        if (
            matches.some(
                item =>
                    orderChannels.rows.filter(row => String(row.orderId) === String(item.orderId)).length !==
                    1,
            )
        )
            reasons.push('ambiguous-order-channel');
        if (candidateChannelIds.length > 1) reasons.push('address-copy-review-required');
        return {
            id: address.id,
            customerId: address.customerId,
            fingerprint,
            candidateChannelIds,
            matches,
            defaultShippingAddress: Boolean(address.defaultShippingAddress),
            defaultBillingAddress: Boolean(address.defaultBillingAddress),
            reasons,
        };
    });
    // Original address values and JSON strings never leave this function.
    return { available, rows, issues, fingerprintScope: 'this-preflight-only' };
}

export async function collectCustomerDependencies(adapter, customerIds, userIds, read, customerOrders) {
    const groups = {};
    const customerOrderIds = (customerOrders?.rows ?? []).map(row => row.id);
    for (const [table, fields] of BUSINESS)
        groups[table] = await read(table, ['customerId'], fields, customerIds);
    for (const [table, fields] of BUSINESS) {
        const orderSelectors = fields.filter(field =>
            ['orderId', 'lockedOrderId', 'usedOrderId'].includes(field),
        );
        if (!orderSelectors.length) continue;
        const linked = await read(table, orderSelectors, ['customerId', ...fields], customerOrderIds);
        groups[table].available =
            groups[table].available && linked.available && Boolean(customerOrders?.available);
        groups[table].rows = [
            ...new Map([...groups[table].rows, ...linked.rows].map(row => [String(row.id), row])).values(),
        ];
    }
    const couponIds = groups.customer_coupon.rows.map(row => row.id);
    for (const table of ['coupon_ledger_entry', 'coupon_order_allocation']) {
        const fields = BUSINESS.find(item => item[0] === table)[1];
        const linked = await read(table, ['customerCouponId'], ['customerId', ...fields], couponIds);
        groups[table].available = groups[table].available && linked.available;
        groups[table].rows = [
            ...new Map([...groups[table].rows, ...linked.rows].map(row => [String(row.id), row])).values(),
        ];
    }
    groups.customer_groups_customer_group = await joinRows(
        adapter,
        'customer_groups_customer_group',
        'customerId',
        ['customerGroupId'],
        customerIds,
    );
    groups.customer_group = await read(
        'customer_group',
        ['id'],
        [],
        [...new Set(groups.customer_groups_customer_group.rows.map(row => row.customerGroupId))],
    );
    groups.user = await read('user', ['id'], ['verified', 'deletedAt'], userIds);
    groups.authentication_method = await read('authentication_method', ['userId'], ['type'], userIds);
    groups.administrator = await read('administrator', ['userId'], ['deletedAt'], userIds);
    groups.session = await read(
        'session',
        ['userId'],
        ['activeOrderId', 'activeChannelId', 'invalidated', 'expires', 'authenticationStrategy'],
        userIds,
    );
    const orderSessions = await read(
        'session',
        ['activeOrderId'],
        ['userId', 'activeChannelId', 'invalidated', 'expires', 'authenticationStrategy'],
        customerOrderIds,
    );
    groups.session.available =
        groups.session.available && orderSessions.available && Boolean(customerOrders?.available);
    groups.session.rows = [
        ...new Map(
            [...groups.session.rows, ...orderSessions.rows].map(row => [String(row.id), row]),
        ).values(),
    ];
    groups.api_key = await read('api_key', ['userId', 'ownerId'], ['deletedAt'], userIds);
    groups.api_key_channels_channel = await joinRows(
        adapter,
        'api_key_channels_channel',
        'apiKeyId',
        ['channelId'],
        groups.api_key.rows.map(row => row.id),
    );
    groups.user_roles_role = await joinRows(adapter, 'user_roles_role', 'userId', ['roleId'], userIds);
    const roleIds = [...new Set(groups.user_roles_role.rows.map(row => row.roleId))];
    groups.role = await read('role', ['id'], ['code', 'permissions'], roleIds);
    groups.role_channels_channel = await joinRows(
        adapter,
        'role_channels_channel',
        'roleId',
        ['channelId'],
        roleIds,
    );
    const orderIds = [
        ...new Set(
            Object.values(groups).flatMap(group =>
                group.rows.flatMap(row =>
                    ['orderId', 'lockedOrderId', 'usedOrderId', 'activeOrderId']
                        .map(field => row[field])
                        .filter(id => id != null),
                ),
            ),
        ),
    ];
    groups.related_order = await read('order', ['id'], ['customerId'], orderIds);
    const channelRows = await joinRows(adapter, 'order_channels_channel', 'orderId', ['channelId'], orderIds);
    groups.related_order.available = groups.related_order.available && channelRows.available;
    for (const row of groups.related_order.rows)
        row.channelIds = channelRows.rows
            .filter(item => String(item.orderId) === String(row.id))
            .map(item => String(item.channelId));
    return {
        groups,
        addressMatches: await addressMatches(adapter, customerIds, read),
        schema: await collectCustomerRelationSchema(adapter),
    };
}

export function redactCustomerDependencies(evidence, group, reference) {
    if (!evidence) return null;
    return {
        format: 1,
        groups: Object.fromEntries(
            Object.entries(evidence.groups).map(([table, rows]) => [
                table,
                group(table === 'related_order' ? 'order' : table, rows),
            ]),
        ),
        addressMatches: {
            available: evidence.addressMatches.available,
            fingerprintScope: evidence.addressMatches.fingerprintScope,
            rows: evidence.addressMatches.rows.map(({ id, customerId, matches, ...row }) => ({
                ...row,
                entityRef: reference('address', id),
                customerRef: reference('customers', customerId),
                matches: matches.map(item => ({
                    orderRef: reference('order', item.orderId),
                    kind: item.kind,
                    fingerprint: item.fingerprint,
                })),
            })),
            issues: evidence.addressMatches.issues.map(item => ({
                customerRef: reference('customers', item.customerId),
                orderRef: reference('order', item.orderId),
                reason: item.reason,
            })),
        },
        schema: evidence.schema,
    };
}

export function customerDependencyFacts(evidence, customer, login, knownChannels, addressRows) {
    const facts = [];
    if (!evidence || evidence.format !== 1)
        return ['customer-dependency-inventory', 'customer-reference-closure'];
    const rows = name =>
        evidence.groups?.[name]?.available && Array.isArray(evidence.groups[name].rows)
            ? evidence.groups[name].rows
            : null;
    for (const name of CUSTOMER_DEPENDENCY_GROUPS) if (!rows(name)) facts.push(`missing-dependency:${name}`);
    if (!evidence.schema?.available || !Array.isArray(evidence.schema?.edges))
        facts.push('customer-dependency-schema');
    if (
        evidence.schema?.edges?.some(
            edge =>
                !KNOWN_EDGES.has(`${edge.tableName}.${edge.columnName}:${edge.targetTable}`) ||
                (edge.kind === 'foreign-key' && edge.targetColumn !== 'id'),
        )
    )
        facts.push('unknown-customer-user-address-reference');
    // Schema names cannot prove the absence of IDs hidden in JSON, text or application logic.
    facts.push('soft-reference-source-review-required');
    if (evidence.schema?.opaqueColumns?.length) facts.push('opaque-reference-review-required');
    const customerRef = customer.entityRef;
    const customerChannels = new Set((customer.channels ?? []).map(channel => String(channel.id)));
    const orders = rows('related_order') ?? [];
    const coupons = rows('customer_coupon') ?? [];
    for (const [table, group] of Object.entries(evidence.groups ?? {})) {
        if (!group.available) continue;
        const seen = new Set();
        for (const row of group.rows) {
            if (!row.entityRef || seen.has(row.entityRef)) facts.push('duplicate-dependency-reference');
            seen.add(row.entityRef);
            if (row.channelId != null && !knownChannels.has(row.channelId))
                facts.push('unknown-dependency-channel');
            if (
                row.customerRef === customerRef &&
                row.channelId != null &&
                !customerChannels.has(row.channelId)
            )
                facts.push('cross-channel-customer-dependency');
            if (
                row.customerRef !== customerRef &&
                !coupons.some(
                    coupon =>
                        coupon.customerRef === customerRef && coupon.entityRef === row.customerCouponRef,
                ) &&
                !['orderRef', 'lockedOrderRef', 'usedOrderRef'].some(key =>
                    orders.some(order => order.entityRef === row[key] && order.customerRef === customerRef),
                )
            )
                continue;
            for (const key of ['orderRef', 'lockedOrderRef', 'usedOrderRef']) {
                if (row[key] == null) continue;
                const order = orders.find(item => item.entityRef === row[key]);
                if (
                    !order ||
                    (row.customerRef == null
                        ? table !== 'history_entry'
                        : order.customerRef !== row.customerRef) ||
                    order.channelIds.length !== 1 ||
                    (row.channelId != null && !order.channelIds.includes(row.channelId))
                )
                    facts.push('cross-channel-order-dependency');
            }
            if (row.customerCouponRef != null) {
                const coupon = coupons.find(item => item.entityRef === row.customerCouponRef);
                if (!coupon || coupon.customerRef !== row.customerRef || coupon.channelId !== row.channelId)
                    facts.push('coupon-reference-mismatch');
            }
            if (table === 'history_entry' && row.customerRef === customerRef && row.orderRef == null)
                facts.push('customer-history-owner-unresolved');
            if (table === 'customer_groups_customer_group' && row.customerRef === customerRef) {
                facts.push('customer-group-assignment-review');
                if (
                    !(rows('customer_group') ?? []).some(
                        groupRow => groupRow.entityRef === row.customerGroupRef,
                    )
                )
                    facts.push('missing-customer-group');
            }
        }
    }
    if (login?.userRef) {
        if (!(rows('user') ?? []).some(row => row.entityRef === login.userRef))
            facts.push('missing-login-user');
        if ((rows('administrator') ?? []).some(row => row.userRef === login.userRef && row.deletedAt == null))
            facts.push('administrator-customer-identity-overlap');
        if (
            (rows('api_key') ?? []).some(
                row => [row.userRef, row.ownerRef].includes(login.userRef) && row.deletedAt == null,
            )
        )
            facts.push('customer-api-key-review');
        if (
            (rows('authentication_method') ?? []).some(
                row => row.userRef === login.userRef && row.type !== 'NativeAuthenticationMethod',
            )
        )
            facts.push('non-native-customer-authentication');
        for (const session of (rows('session') ?? []).filter(row => row.userRef === login.userRef)) {
            if (!session.invalidated) facts.push('customer-session-invalidation-plan');
            if (session.activeChannelId != null && !customerChannels.has(String(session.activeChannelId)))
                facts.push('cross-channel-session');
            const order = orders.find(row => row.entityRef === session.activeOrderRef);
            if (
                session.activeOrderRef != null &&
                (!order || order.customerRef !== customerRef || order.channelIds.length !== 1)
            )
                facts.push('cross-customer-session-order');
        }
        for (const link of (rows('user_roles_role') ?? []).filter(row => row.userRef === login.userRef)) {
            const role = (rows('role') ?? []).find(row => row.entityRef === link.roleRef);
            const permissions = Array.isArray(role?.permissions)
                ? role.permissions
                : String(role?.permissions ?? '').split(',');
            if (!role || permissions.some(permission => !['Authenticated', 'Owner'].includes(permission)))
                facts.push('customer-role-permission-review');
        }
    }
    for (const session of rows('session') ?? []) {
        const order = orders.find(row => row.entityRef === session.activeOrderRef);
        if (order?.customerRef === customerRef && session.userRef !== login?.userRef)
            facts.push('foreign-session-customer-order');
    }
    const matches = evidence.addressMatches;
    const selected = matches?.rows?.filter(row => row.customerRef === customerRef);
    if (
        !matches?.available ||
        !selected ||
        !addressRows ||
        selected.length !== addressRows.length ||
        selected.some(row => !addressRows.some(address => address.entityRef === row.entityRef))
    )
        facts.push('address-match-inventory');
    for (const row of selected ?? []) {
        facts.push(...row.reasons);
        if (row.candidateChannelIds.some(id => !knownChannels.has(id) || !customerChannels.has(id)))
            facts.push('cross-channel-address-candidate');
    }
    if (matches?.issues?.some(issue => issue.customerRef === customerRef))
        facts.push('address-snapshot-review-required');
    return [...new Set(facts)];
}
