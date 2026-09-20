#!/usr/bin/env node

import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    FORBIDDEN_SHARED_ASSOCIATION_KEYS,
    collectStoreIsolationSnapshot,
    createStoreIsolationAdapter,
} from './store-isolation-data-preflight.mjs';

const DIRECT_CHANNEL_TABLES = [
    'store_domain',
    'store_profile',
    'store_administrator_access',
    'storefront_content_settings',
    'storefront_content_block',
    'storefront_content_item',
    'storefront_cart',
    'storefront_page_view',
    'storefront_daily_visitor',
    'storefront_promotion_page',
    'store_coupon_campaign_config',
    'customer_coupon',
    'coupon_ledger_entry',
    'coupon_order_allocation',
    'referral_program_config',
    'referral_account',
    'referral_relationship',
    'referral_reward',
    'referral_wallet',
    'referral_ledger_entry',
    'referral_balance_use',
    'referral_wallet_usage',
    'referral_withdrawal',
    'store_usdt_wallet',
    'store_usdt_wallet_audit',
    'storefront_usdt_checkout_quote',
    'storefront_usdt_payment_intent',
    'store_usdt_manual_refund',
    'catalog_import_job',
    'catalog_inventory_lot',
    'catalog_inventory_lot_movement',
    'catalog_inventory_policy',
    'catalog_source_binding',
    'catalog_supplier',
    'catalog_variant_cost_record',
    'catalog_variant_supplier',
    'catalog_order_profit_expense',
    'manual_digital_delivery',
    'after_sales_request',
    'auto_card_config',
    'auto_card_pool_item',
    'auto_card_delivery',
    'product_packaging_rule',
    'storefront_review',
    'image_generation_config',
    'image_generation_job',
    'image_generation_dispatch',
    'image_generation_cost_event',
    'image_model_config',
    'image_private_asset',
    'image_usage_quota_bucket',
    'image_usage_quota_event',
];

const REQUIRED_DOMAINS = [
    ['store-domain', 'store_domain'],
    ['store-profile', 'store_profile'],
    ['content', 'storefront_content_settings'],
    ['cart', 'storefront_cart'],
    ['coupon', 'customer_coupon'],
    ['referral-wallet', 'referral_wallet'],
    ['usdt-payment', 'storefront_usdt_payment_intent'],
    ['catalog', 'catalog_import_job'],
    ['delivery', 'manual_digital_delivery'],
    ['after-sales', 'after_sales_request'],
    ['review', 'storefront_review'],
    ['image', 'image_generation_job'],
];

const CHECKS = [
    {
        key: 'duplicate-live-member-identities',
        severity: 'P1',
        needs: [
            ['user', ['id', 'identifier', 'deletedAt']],
            ['customer', ['id', 'userId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM (
            SELECT LOWER(TRIM(u.identifier)) AS normalizedIdentifier
            FROM \`user\` u INNER JOIN customer c ON c.userId = u.id
            WHERE u.deletedAt IS NULL AND TRIM(u.identifier) <> ''
            GROUP BY LOWER(TRIM(u.identifier)) HAVING COUNT(DISTINCT c.id) > 1
        ) duplicateIdentities`,
    },
    {
        key: 'customers-without-channel-membership',
        severity: 'P1',
        needs: [
            ['customer', ['id']],
            ['customer_channels_channel', ['customerId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM customer c
            LEFT JOIN customer_channels_channel relation ON relation.customerId = c.id
            WHERE relation.customerId IS NULL`,
    },
    {
        key: 'orders-without-sales-owner',
        severity: 'P1',
        needs: [['order', ['salesChannelId']]],
        sql: 'SELECT COUNT(*) AS value FROM `order` WHERE salesChannelId IS NULL',
    },
    {
        key: 'orders-without-channel-membership',
        severity: 'P1',
        needs: [
            ['order', ['id']],
            ['order_channels_channel', ['orderId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM \`order\` item
            WHERE NOT EXISTS (
                SELECT 1 FROM order_channels_channel relation WHERE relation.orderId = item.id
            )`,
    },
    {
        key: 'orders-with-multiple-nondefault-memberships',
        severity: 'P1',
        needs: [
            ['order', ['id']],
            ['order_channels_channel', ['orderId', 'channelId']],
            ['channel', ['id', 'code']],
        ],
        sql: `SELECT COUNT(*) AS value FROM (
            SELECT item.id
            FROM \`order\` item
            INNER JOIN order_channels_channel relation ON relation.orderId = item.id
            INNER JOIN channel channelItem ON channelItem.id = relation.channelId
            WHERE channelItem.code <> '__default_channel__'
            GROUP BY item.id
            HAVING COUNT(DISTINCT relation.channelId) > 1
        ) ambiguousOrders`,
    },
    {
        key: 'order-sales-owner-relation-mismatch',
        severity: 'P1',
        needs: [
            ['order', ['id', 'salesChannelId']],
            ['order_channels_channel', ['orderId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM \`order\` item
            WHERE item.salesChannelId IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM order_channels_channel relation
                WHERE relation.orderId = item.id AND relation.channelId = item.salesChannelId
            )`,
    },
    {
        key: 'cart-checkout-order-channel-mismatch',
        severity: 'P1',
        needs: [
            ['storefront_cart', ['id', 'channelId']],
            ['storefront_cart_checkout', ['cartId', 'orderId']],
            ['order_channels_channel', ['orderId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM storefront_cart_checkout checkoutItem
            INNER JOIN storefront_cart cart ON cart.id = checkoutItem.cartId
            LEFT JOIN order_channels_channel relation
              ON relation.orderId = checkoutItem.orderId AND relation.channelId = cart.channelId
            WHERE relation.orderId IS NULL`,
    },
    {
        key: 'wallet-ledger-owner-mismatch',
        severity: 'P1',
        needs: [
            ['referral_wallet', ['id', 'channelId', 'customerId', 'currencyCode']],
            ['referral_ledger_entry', ['walletId', 'channelId', 'customerId', 'currencyCode']],
        ],
        sql: `SELECT COUNT(*) AS value FROM referral_ledger_entry ledger
            INNER JOIN referral_wallet wallet ON wallet.id = ledger.walletId
            WHERE ledger.channelId <> wallet.channelId OR ledger.customerId <> wallet.customerId
               OR ledger.currencyCode <> wallet.currencyCode`,
    },
    {
        key: 'wallet-usage-owner-mismatch',
        severity: 'P1',
        needs: [
            ['referral_wallet', ['id', 'channelId', 'customerId', 'currencyCode']],
            ['referral_wallet_usage', ['walletId', 'channelId', 'customerId', 'currencyCode']],
        ],
        sql: `SELECT COUNT(*) AS value FROM referral_wallet_usage usageItem
            INNER JOIN referral_wallet wallet ON wallet.id = usageItem.walletId
            WHERE usageItem.channelId <> wallet.channelId OR usageItem.customerId <> wallet.customerId
               OR usageItem.currencyCode <> wallet.currencyCode`,
    },
    {
        key: 'wallet-latest-ledger-balance-mismatch',
        severity: 'P1',
        needs: [
            ['referral_wallet', ['id', 'availableBalance', 'pendingBalance', 'reservedBalance']],
            ['referral_ledger_entry', ['id', 'walletId', 'availableAfter', 'pendingAfter', 'reservedAfter']],
        ],
        sql: `SELECT COUNT(*) AS value FROM referral_wallet wallet
            INNER JOIN referral_ledger_entry ledger ON ledger.id = (
                SELECT MAX(latest.id) FROM referral_ledger_entry latest WHERE latest.walletId = wallet.id
            ) WHERE wallet.availableBalance <> ledger.availableAfter
                OR wallet.pendingBalance <> ledger.pendingAfter
                OR wallet.reservedBalance <> ledger.reservedAfter`,
    },
    {
        key: 'coupon-order-channel-mismatch',
        severity: 'P1',
        needs: [
            ['customer_coupon', ['channelId', 'lockedOrderId', 'usedOrderId']],
            ['order_channels_channel', ['orderId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM customer_coupon coupon
            WHERE (coupon.lockedOrderId IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM order_channels_channel relation
                WHERE relation.orderId = coupon.lockedOrderId AND relation.channelId = coupon.channelId
            )) OR (coupon.usedOrderId IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM order_channels_channel relation
                WHERE relation.orderId = coupon.usedOrderId AND relation.channelId = coupon.channelId
            ))`,
    },
    {
        key: 'usdt-intent-order-channel-mismatch',
        severity: 'P1',
        needs: [
            ['storefront_usdt_payment_intent', ['channelId', 'orderId']],
            ['order_channels_channel', ['orderId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM storefront_usdt_payment_intent intent
            WHERE NOT EXISTS (SELECT 1 FROM order_channels_channel relation
                WHERE relation.orderId = intent.orderId AND relation.channelId = intent.channelId)`,
    },
    {
        key: 'usdt-refund-order-channel-mismatch',
        severity: 'P1',
        needs: [
            ['store_usdt_manual_refund', ['channelId', 'orderId']],
            ['order_channels_channel', ['orderId', 'channelId']],
        ],
        sql: `SELECT COUNT(*) AS value FROM store_usdt_manual_refund refundItem
            WHERE NOT EXISTS (SELECT 1 FROM order_channels_channel relation
                WHERE relation.orderId = refundItem.orderId AND relation.channelId = refundItem.channelId)`,
    },
    {
        key: 'native-default-used-as-public-store',
        severity: 'P1',
        needs: [
            ['channel', ['id', 'code']],
            ['store_domain', ['channelId', 'isPrimary', 'status']],
        ],
        sql: `SELECT COUNT(*) AS value FROM channel channelItem
            INNER JOIN store_domain domainItem ON domainItem.channelId = channelItem.id
            WHERE channelItem.code = '__default_channel__'
              AND domainItem.isPrimary = 1 AND domainItem.status = 'ACTIVE'`,
    },
];

function quoted(identifier) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(identifier)) throw new Error('Unsafe SQL identifier');
    return `\`${identifier}\``;
}

function safeInteger(value) {
    const result = Number(value ?? 0);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error('Unsafe aggregate count');
    return result;
}

function fileReference(auditKey, fileName) {
    return createHmac('sha256', auditKey).update(`digital-file\u0000${fileName}`).digest('hex').slice(0, 24);
}

async function createSchemaReader(adapter) {
    const tableCache = new Map();
    const columnCache = new Map();
    const tableExists = async tableName => {
        if (!tableCache.has(tableName)) tableCache.set(tableName, await adapter.tableExists(tableName));
        return tableCache.get(tableName);
    };
    const columnExists = async (tableName, columnName) => {
        const key = `${tableName}.${columnName}`;
        if (!columnCache.has(key)) {
            columnCache.set(
                key,
                (await tableExists(tableName)) && (await adapter.columnExists(tableName, columnName)),
            );
        }
        return columnCache.get(key);
    };
    return { tableExists, columnExists };
}

async function requirementsAvailable(schema, needs) {
    for (const [tableName, columns] of needs) {
        if (!(await schema.tableExists(tableName))) return false;
        for (const columnName of columns)
            if (!(await schema.columnExists(tableName, columnName))) return false;
    }
    return true;
}

async function countCheck(adapter, schema, definition) {
    if (!(await requirementsAvailable(schema, definition.needs))) {
        return { key: definition.key, severity: definition.severity, status: 'UNAVAILABLE', count: null };
    }
    const [row = {}] = await adapter.query(definition.sql);
    const count = safeInteger(row.value);
    return {
        key: definition.key,
        severity: definition.severity,
        status: count === 0 ? 'PASS' : 'FAIL',
        count,
    };
}

async function structuralChecks(adapter, schema) {
    const hasSalesOwner = await schema.columnExists('order', 'salesChannelId');
    const hasCustomerStoreEntry = await schema.tableExists('customer_store_entry');
    const hasGroupOwner = await schema.columnExists('customer_group', 'channelId');
    const importColumns = ['expectedProductUpdatedAt', 'expectedVariantUpdatedAt'];
    const importMetadata = [];
    for (const columnName of importColumns) {
        importMetadata.push(await adapter.columnMetadata('catalog_import_row', columnName));
    }
    const preciseImportTimestamps = importMetadata.every(
        metadata => metadata && (adapter.kind === 'sqlite' || Number(metadata.datetimePrecision) >= 6),
    );
    return [
        {
            key: 'unique-order-sales-owner',
            severity: 'P1',
            status: hasSalesOwner ? 'PASS' : 'FAIL',
            evidence: hasSalesOwner ? 'order.salesChannelId' : 'missing-order.salesChannelId',
        },
        {
            key: 'shared-member-store-state-boundary',
            severity: 'P1',
            status: hasCustomerStoreEntry ? 'PASS' : 'FAIL',
            evidence: hasCustomerStoreEntry ? 'customer_store_entry' : 'missing-customer_store_entry',
        },
        {
            key: 'customer-group-store-owner',
            severity: 'P1',
            status: hasGroupOwner ? 'PASS' : 'FAIL',
            evidence: hasGroupOwner ? 'customer_group.channelId' : 'missing-customer_group.channelId',
        },
        {
            key: 'catalog-import-microsecond-precision',
            severity: 'P2',
            status: preciseImportTimestamps ? 'PASS' : 'FAIL',
            evidence: preciseImportTimestamps ? 'precision-ok' : 'precision-missing-or-below-6',
        },
    ];
}

async function collectOrphanChecks(adapter, schema) {
    const checks = [];
    for (const tableName of DIRECT_CHANNEL_TABLES) {
        if (!(await schema.columnExists(tableName, 'channelId'))) continue;
        const [row = {}] = await adapter.query(
            `SELECT COUNT(*) AS value FROM ${quoted(tableName)} item
             LEFT JOIN channel channelItem ON channelItem.id = item.channelId
             WHERE item.channelId IS NULL OR channelItem.id IS NULL`,
        );
        const count = safeInteger(row.value);
        checks.push({
            key: `orphan-channel-${tableName.replaceAll('_', '-')}`,
            severity: 'P1',
            status: count === 0 ? 'PASS' : 'FAIL',
            count,
        });
    }
    return checks;
}

async function collectConfigurationChecks(adapter, schema) {
    const checks = [];
    for (const [key, tableName] of [
        ['store-profile-per-channel', 'store_profile'],
        ['content-settings-per-channel', 'storefront_content_settings'],
    ]) {
        if (
            !(await requirementsAvailable(schema, [
                ['channel', ['id', 'code']],
                [tableName, ['channelId']],
            ]))
        ) {
            checks.push({ key, severity: 'P1', status: 'UNAVAILABLE', count: null });
            continue;
        }
        const [row = {}] = await adapter.query(
            `SELECT COUNT(*) AS value FROM channel channelItem
             LEFT JOIN ${quoted(tableName)} item ON item.channelId = channelItem.id
             WHERE channelItem.code <> '__default_channel__' AND item.channelId IS NULL`,
        );
        const count = safeInteger(row.value);
        checks.push({ key, severity: 'P1', status: count === 0 ? 'PASS' : 'FAIL', count });
    }
    if (
        await requirementsAvailable(schema, [
            ['channel', ['id', 'code']],
            ['store_domain', ['channelId', 'isPrimary', 'status']],
        ])
    ) {
        const [row = {}] = await adapter.query(
            `SELECT COUNT(*) AS value FROM channel channelItem
             LEFT JOIN store_domain domainItem ON domainItem.channelId = channelItem.id
                AND domainItem.isPrimary = 1 AND domainItem.status = 'ACTIVE'
             WHERE channelItem.code <> '__default_channel__' AND domainItem.channelId IS NULL`,
        );
        const count = safeInteger(row.value);
        checks.push({
            key: 'active-primary-domain-per-channel',
            severity: 'P1',
            status: count ? 'FAIL' : 'PASS',
            count,
        });
    } else {
        checks.push({
            key: 'active-primary-domain-per-channel',
            severity: 'P1',
            status: 'UNAVAILABLE',
            count: null,
        });
    }
    return checks;
}

async function collectTableCoverage(schema) {
    const coverage = [];
    for (const [domain, tableName] of REQUIRED_DOMAINS) {
        coverage.push({ domain, table: tableName, available: await schema.tableExists(tableName) });
    }
    return coverage;
}

async function collectPerChannelCounts(adapter, schema, channels) {
    const result = Object.fromEntries(channels.map(channel => [String(channel.code), {}]));
    for (const tableName of DIRECT_CHANNEL_TABLES) {
        if (!(await schema.columnExists(tableName, 'channelId'))) continue;
        const rows = await adapter.query(
            `SELECT channelId, COUNT(*) AS value FROM ${quoted(tableName)}
             WHERE channelId IS NOT NULL GROUP BY channelId ORDER BY channelId`,
        );
        const byChannel = new Map(rows.map(row => [String(row.channelId), safeInteger(row.value)]));
        for (const channel of channels)
            result[String(channel.code)][tableName] = byChannel.get(String(channel.id)) ?? 0;
    }
    return result;
}

async function collectDefaultChannelSeparation(adapter, schema, channels, targetChannelCode) {
    const defaultChannel = channels.find(channel => channel.code === '__default_channel__');
    const targetChannel = channels.find(channel => channel.code === targetChannelCode);
    const unavailable = {
        available: false,
        total: null,
        noMembership: null,
        defaultOnly: null,
        singleNonDefault: null,
        multipleNonDefault: null,
    };
    let orders = unavailable;
    if (
        await requirementsAvailable(schema, [
            ['order', ['id']],
            ['order_channels_channel', ['orderId', 'channelId']],
            ['channel', ['id', 'code']],
        ])
    ) {
        const [row = {}] = await adapter.query(`SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN grouped.defaultMemberships = 0 AND grouped.nonDefaultMemberships = 0
                THEN 1 ELSE 0 END) AS noMembership,
            SUM(CASE WHEN grouped.defaultMemberships > 0 AND grouped.nonDefaultMemberships = 0
                THEN 1 ELSE 0 END) AS defaultOnly,
            SUM(CASE WHEN grouped.nonDefaultMemberships = 1 THEN 1 ELSE 0 END) AS singleNonDefault,
            SUM(CASE WHEN grouped.nonDefaultMemberships > 1 THEN 1 ELSE 0 END) AS multipleNonDefault
            FROM (
                SELECT item.id,
                    COUNT(DISTINCT CASE WHEN channelItem.code = '__default_channel__'
                        THEN relation.channelId END) AS defaultMemberships,
                    COUNT(DISTINCT CASE WHEN channelItem.code <> '__default_channel__'
                        THEN relation.channelId END) AS nonDefaultMemberships
                FROM \`order\` item
                LEFT JOIN order_channels_channel relation ON relation.orderId = item.id
                LEFT JOIN channel channelItem ON channelItem.id = relation.channelId
                GROUP BY item.id
            ) grouped`);
        orders = {
            available: true,
            total: safeInteger(row.total),
            noMembership: safeInteger(row.noMembership),
            defaultOnly: safeInteger(row.defaultOnly),
            singleNonDefault: safeInteger(row.singleNonDefault),
            multipleNonDefault: safeInteger(row.multipleNonDefault),
        };
    }
    let defaultActivePrimaryDomains = null;
    if (
        defaultChannel &&
        (await requirementsAvailable(schema, [['store_domain', ['channelId', 'isPrimary', 'status']]]))
    ) {
        const [row = {}] = await adapter.query(
            `SELECT COUNT(*) AS value FROM store_domain
             WHERE channelId = ? AND isPrimary = 1 AND status = 'ACTIVE'`,
            [defaultChannel.id],
        );
        defaultActivePrimaryDomains = safeInteger(row.value);
    }
    const mappingDeterministic =
        orders.available && orders.noMembership === 0 && orders.multipleNonDefault === 0;
    return {
        mode: 'read-only-plan-input',
        targetChannelCode,
        defaultChannelPresent: Boolean(defaultChannel),
        targetChannelPresent: Boolean(targetChannel),
        defaultActivePrimaryDomains,
        orders,
        mappingDeterministic,
        readyForReviewedCutover:
            Boolean(defaultChannel) &&
            !targetChannel &&
            defaultActivePrimaryDomains === 1 &&
            mappingDeterministic,
    };
}

function sanitizeSnapshot(snapshot, auditKey) {
    const associations = {};
    for (const [key, value] of Object.entries(snapshot.associations)) {
        associations[key] = { available: value.available, sharedCount: value.shared.length };
    }
    return {
        associations,
        sharedResources: {
            policy: 'explicit-configuration-required',
            customers: 'shared-member-identity-expected',
            icloud: 'platform-shared',
        },
        icloud: snapshot.icloud.map(item => ({
            table: item.tableName,
            exists: item.exists,
            hasChannelId: item.hasChannelId,
            totalRows: item.totalRows,
            unscopedRows: item.unscopedRows,
        })),
        digitalDelivery: {
            configured: snapshot.digitalDelivery.configured,
            exists: snapshot.digitalDelivery.exists,
            legacyFileCount: snapshot.digitalDelivery.legacyFiles.length,
            legacyFiles: snapshot.digitalDelivery.legacyFiles.map(file => ({
                fileRef: fileReference(auditKey, file.name),
                extension: path.extname(file.name),
                bytes: safeInteger(file.bytes),
                candidateChannelCount: file.candidateChannelIds?.length ?? 0,
            })),
            unsafeLegacyFileCount: snapshot.digitalDelivery.unsafeLegacyFileNames?.length ?? 0,
            channelDirectories: snapshot.digitalDelivery.channelDirectories.map(item => ({
                channelRef: createHmac('sha256', auditKey)
                    .update(`digital-channel\u0000${item.channelId}`)
                    .digest('hex')
                    .slice(0, 24),
                fileCount: safeInteger(item.fileCount),
            })),
        },
    };
}

export function sharedResourceIsolationChecks(snapshot) {
    return FORBIDDEN_SHARED_ASSOCIATION_KEYS.map(key => {
        const association = snapshot.associations[key];
        if (!association?.available) {
            return {
                key: `shared-${key}`,
                severity: 'P1',
                status: 'UNAVAILABLE',
                count: null,
                detail: 'Required ownership relation is unavailable',
            };
        }
        const value = association.shared.length;
        return {
            key: `shared-${key}`,
            severity: 'P1',
            status: value === 0 ? 'PASS' : 'FAIL',
            count: value,
            detail:
                value === 0
                    ? 'No resource is shared across operating Channels'
                    : 'Store-owned resources must be cloned instead of shared across Channels',
        };
    });
}

export async function collectStoreAutonomyAudit(adapter, options = {}) {
    const auditKey = options.auditKey || randomBytes(32).toString('hex');
    const schema = await createSchemaReader(adapter);
    if (!(await schema.tableExists('channel'))) throw new Error('Required channel table is unavailable');
    const channels = (await adapter.query('SELECT id, code FROM channel ORDER BY id')).map(row => ({
        id: String(row.id),
        code: String(row.code),
    }));
    const structure = await structuralChecks(adapter, schema);
    if (options.requireExpectedSchema && structure.some(check => check.status === 'FAIL')) {
        throw new Error('Required store isolation database structure is unavailable');
    }
    const checks = [];
    for (const definition of CHECKS) checks.push(await countCheck(adapter, schema, definition));
    checks.push(...(await collectOrphanChecks(adapter, schema)));
    checks.push(...(await collectConfigurationChecks(adapter, schema)));
    const coverage = await collectTableCoverage(schema);
    const snapshot = await collectStoreIsolationSnapshot(adapter, options.digitalDeliveryRoot);
    checks.push(...sharedResourceIsolationChecks(snapshot));
    const targetChannelCode = options.targetChannelCode || 'moyao-ai';
    const unavailable = checks.filter(check => check.status === 'UNAVAILABLE').length;
    const failed = [...structure, ...checks].filter(check => check.status === 'FAIL');
    const coverageComplete =
        channels.length >= 3 && coverage.every(item => item.available) && unavailable === 0;
    const verdict = failed.length > 0 ? 'NO_GO' : coverageComplete ? 'GO' : 'INCOMPLETE';
    return {
        format: 2,
        schema: 'vendure-store-autonomy-audit',
        generatedAt: new Date().toISOString(),
        mode: 'read-only-consistent-snapshot',
        verdict,
        coverageComplete,
        channelCount: channels.length,
        channels: channels.map(channel => ({ code: channel.code })),
        summary: {
            failedChecks: failed.length,
            unavailableChecks: unavailable,
            coveredDomains: coverage.filter(item => item.available).length,
            requiredDomains: coverage.length,
        },
        structure,
        checks,
        coverage,
        perChannelCounts: await collectPerChannelCounts(adapter, schema, channels),
        defaultChannelSeparation: await collectDefaultChannelSeparation(
            adapter,
            schema,
            channels,
            targetChannelCode,
        ),
        snapshot: sanitizeSnapshot(snapshot, auditKey),
    };
}

async function main() {
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        const report = await collectStoreAutonomyAudit(adapter, {
            auditKey: process.env.STORE_ISOLATION_AUDIT_KEY?.trim() || undefined,
            digitalDeliveryRoot: process.env.DIGITAL_DELIVERY_ROOT,
            requireExpectedSchema: process.env.STORE_ISOLATION_REQUIRE_EXPECTED_SCHEMA === '1',
            targetChannelCode: process.env.STORE_ISOLATION_TARGET_CHANNEL_CODE?.trim() || undefined,
        });
        process.stdout.write(`${JSON.stringify(report)}\n`);
    } finally {
        await adapter.close();
    }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
