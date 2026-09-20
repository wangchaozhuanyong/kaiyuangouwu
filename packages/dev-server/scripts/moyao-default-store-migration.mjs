import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_CHANNEL_CODE = '__default_channel__';
const TARGET_CHANNEL_CODE = 'moyao-ai';
const REQUIRED_TARGET_ROLE_CODES = ['__customer_role__', '__super_admin_role__'];

const RELATION_TABLES = [
    ['customer_channels_channel', 'customerId'],
    ['product_channels_channel', 'productId'],
    ['product_variant_channels_channel', 'productVariantId'],
    ['collection_channels_channel', 'collectionId'],
    ['asset_channels_channel', 'assetId'],
    ['facet_channels_channel', 'facetId'],
    ['facet_value_channels_channel', 'facetValueId'],
    ['product_option_group_channels_channel', 'productOptionGroupId'],
    ['product_option_channels_channel', 'productOptionId'],
    ['promotion_channels_channel', 'promotionId'],
    ['system_announcement_channels_channel', 'systemAnnouncementId'],
];

const PROFILE_COLUMNS = [
    'status',
    'isPublished',
    'sortOrder',
    'descriptionZh',
    'descriptionEn',
    'internalNote',
    'logoAssetId',
    'logoOnLightAssetId',
    'logoOnDarkAssetId',
    'taglineZh',
    'taglineEn',
    'brandBackgroundColor',
    'brandPrimaryColor',
    'brandAccentColor',
    'brandHighlightColor',
    'legalEntityName',
    'legalRegistrationCountry',
    'supportEmail',
    'privacyEmail',
];

const MOVED_CHANNEL_TABLES = [
    'customer_group',
    'storefront_content_block',
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
    'referral_poster_template',
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
    'customer_delivery_email',
    'manual_digital_delivery',
    'after_sales_request',
    'auto_card_config',
    'auto_card_delivery',
    'packaging_unpack_event',
    'product_packaging_rule',
    'storefront_review',
    'image_generation_config',
    'image_generation_job',
    'image_generation_cost_event',
    'image_model_config',
    'image_private_asset',
    'image_usage_quota_bucket',
    'image_compliance_audit_event',
    'image_prompt_optimization',
    'image_prompt_optimization_attempt',
];

function runtimeRequire(environment) {
    const moduleRoot = environment.STORE_ISOLATION_MODULE_ROOT?.trim();
    return moduleRoot
        ? createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
        : createRequire(import.meta.url);
}

function quoted(identifier) {
    assert.match(identifier, /^[a-zA-Z][a-zA-Z0-9_]*$/u, 'Unsafe SQL identifier');
    return `\`${identifier}\``;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonical(value[key])]),
        );
    }
    return value;
}

export function migrationDigest(details) {
    return createHash('sha256')
        .update(JSON.stringify(canonical(details)))
        .digest('hex');
}

export function assertMoveTargetAvailable(table, sourceIds, targetIds) {
    if (sourceIds.length === 0) return;
    assert.equal(targetIds.length, 0, `${table} already contains target Channel data; review a merge plan`);
}

export function publicMigrationPlan(details) {
    return {
        format: 1,
        schema: 'vendure-moyao-default-store-migration',
        mode: 'reviewed-default-to-dedicated-channel',
        sourceChannelCode: SOURCE_CHANNEL_CODE,
        targetChannelCode: TARGET_CHANNEL_CODE,
        contentBlockCount:
            details.movedRows.storefront_content_block.length +
            details.existingTargetRowCounts.storefront_content_block,
        movedChannelRows: Object.fromEntries(
            Object.entries(details.movedRows).map(([table, ids]) => [table, ids.length]),
        ),
        addedRelations: Object.fromEntries(
            Object.entries(details.relationEntityIds).map(([table, ids]) => [table, ids.length]),
        ),
        removedDefaultRelations: Object.fromEntries(
            Object.entries(details.sourceRelationEntityIds).map(([table, ids]) => [table, ids.length]),
        ),
        crossStoreRelationConflicts: Object.fromEntries(
            Object.entries(details.crossStoreRelationEntityIds).map(([table, ids]) => [table, ids.length]),
        ),
        copiedChannelRows: Object.fromEntries(
            Object.entries(details.copiedEntityIds).map(([table, ids]) => [table, ids.length]),
        ),
        removedDefaultCustomerStoreEntries: details.sourceCustomerStoreEntryIds.length,
        removedDefaultOrderMemberships: details.sourceOrderMembershipIds.length,
        profileWillChange: details.profileDigest !== details.targetProfileDigest,
        contentSettingsWillChange:
            details.sourceHeroAutoplayIntervalSeconds !== details.targetHeroAutoplayIntervalSeconds,
        sellerWillChange: details.sellerSeparationAction !== 'NONE',
        sellerSeparationAction: details.sellerSeparationAction,
        sellerIsolationConflictCount:
            details.sourceSellerOtherChannelIds.length + details.targetSellerOtherChannelIds.length,
        addedRequiredRoleAssignments: details.missingTargetRoleIds.length,
        orderSalesOwnerCount: details.orderSalesOwnerIds.length,
        operationDigest: migrationDigest(details),
    };
}

async function connect(environment) {
    const databaseType = String(environment.DB ?? 'mysql').toLowerCase();
    assert.ok(['mysql', 'mariadb'].includes(databaseType), 'Production migration requires MySQL');
    const mysql = runtimeRequire(environment)('mysql2/promise');
    return mysql.createConnection({
        host: environment.DB_HOST || '127.0.0.1',
        port: Number(environment.DB_PORT || 3306),
        user: environment.DB_USERNAME || 'vendure',
        password: environment.DB_PASSWORD || '',
        database: environment.DB_NAME || 'vendure-dev',
        multipleStatements: false,
    });
}

async function tableExists(connection, table) {
    const [rows] = await connection.execute(
        `SELECT COUNT(*) AS value FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [table],
    );
    return Number(rows[0]?.value ?? 0) === 1;
}

async function columnExists(connection, table, column) {
    const [rows] = await connection.execute(
        `SELECT COUNT(*) AS value FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column],
    );
    return Number(rows[0]?.value ?? 0) === 1;
}

async function selectChannel(connection, code, lock) {
    const [rows] = await connection.execute(
        `SELECT id, code, sellerId FROM channel WHERE code = ?${lock ? ' FOR UPDATE' : ''}`,
        [code],
    );
    assert.equal(rows.length, 1, `Expected exactly one Channel ${code}`);
    return {
        id: String(rows[0].id),
        code: String(rows[0].code),
        sellerId: rows[0].sellerId == null ? null : String(rows[0].sellerId),
    };
}

async function selectProfile(connection, channelId, lock) {
    const projection = ['id', 'updatedAt', ...PROFILE_COLUMNS].map(column => quoted(column)).join(', ');
    const [rows] = await connection.execute(
        `SELECT ${projection} FROM store_profile WHERE channelId = ?${lock ? ' FOR UPDATE' : ''}`,
        [channelId],
    );
    assert.equal(rows.length, 1, 'Expected exactly one StoreProfile per Channel');
    return Object.fromEntries(
        Object.entries(rows[0]).map(([key, value]) => [
            key,
            value instanceof Date ? value.toISOString() : value,
        ]),
    );
}

async function selectIds(connection, sql, parameters) {
    const [rows] = await connection.execute(sql, parameters);
    return rows
        .map(row => String(row.id))
        .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

async function collectDetails(connection, lock = false) {
    const source = await selectChannel(connection, SOURCE_CHANNEL_CODE, lock);
    const target = await selectChannel(connection, TARGET_CHANNEL_CODE, lock);
    assert.notEqual(source.id, target.id, 'Source and target Channels must be different');
    assert.ok(source.sellerId, 'Default Channel requires a Seller before migration');

    const sourceProfile = await selectProfile(connection, source.id, lock);
    const targetProfile = await selectProfile(connection, target.id, lock);

    const [settingsRows] = await connection.execute(
        `SELECT channelId, heroAutoplayIntervalSeconds FROM storefront_content_settings
         WHERE channelId IN (?, ?) ORDER BY channelId${lock ? ' FOR UPDATE' : ''}`,
        [source.id, target.id],
    );
    assert.equal(settingsRows.length, 2, 'Both Channels require storefront content settings');
    const sourceSettings = settingsRows.find(row => String(row.channelId) === source.id);
    const targetSettings = settingsRows.find(row => String(row.channelId) === target.id);
    assert.ok(sourceSettings && targetSettings, 'Storefront content settings are incomplete');

    const relationEntityIds = {};
    const sourceRelationEntityIds = {};
    const crossStoreRelationEntityIds = {};
    for (const [table, entityColumn] of RELATION_TABLES) {
        if (!(await tableExists(connection, table))) {
            relationEntityIds[table] = [];
            sourceRelationEntityIds[table] = [];
            crossStoreRelationEntityIds[table] = [];
            continue;
        }
        sourceRelationEntityIds[table] = await selectIds(
            connection,
            `SELECT source.${quoted(entityColumn)} AS id
             FROM ${quoted(table)} source
             WHERE source.channelId = ?
             ORDER BY source.${quoted(entityColumn)}${lock ? ' FOR UPDATE' : ''}`,
            [source.id],
        );
        relationEntityIds[table] = await selectIds(
            connection,
            `SELECT source.${quoted(entityColumn)} AS id
             FROM ${quoted(table)} source
             WHERE source.channelId = ? AND NOT EXISTS (
                 SELECT 1 FROM ${quoted(table)} target
                 WHERE target.${quoted(entityColumn)} = source.${quoted(entityColumn)}
                   AND target.channelId = ?
             )
             ORDER BY source.${quoted(entityColumn)}${lock ? ' FOR UPDATE' : ''}`,
            [source.id, target.id],
        );
        crossStoreRelationEntityIds[table] =
            table === 'customer_channels_channel'
                ? []
                : await selectIds(
                      connection,
                      `SELECT DISTINCT source.${quoted(entityColumn)} AS id
                       FROM ${quoted(table)} source
                       INNER JOIN ${quoted(table)} other
                           ON other.${quoted(entityColumn)} = source.${quoted(entityColumn)}
                          AND other.channelId NOT IN (?, ?)
                       WHERE source.channelId = ?
                       ORDER BY source.${quoted(entityColumn)}${lock ? ' FOR UPDATE' : ''}`,
                      [source.id, target.id, source.id],
                  );
    }

    const copiedEntityIds = { customer_store_entry: [] };
    let sourceCustomerStoreEntryIds = [];
    if (await tableExists(connection, 'customer_store_entry')) {
        sourceCustomerStoreEntryIds = await selectIds(
            connection,
            `SELECT customerId AS id FROM customer_store_entry
             WHERE channelId = ? ORDER BY customerId${lock ? ' FOR UPDATE' : ''}`,
            [source.id],
        );
        copiedEntityIds.customer_store_entry = await selectIds(
            connection,
            `SELECT source.customerId AS id
             FROM customer_store_entry source
             WHERE source.channelId = ? AND NOT EXISTS (
                 SELECT 1 FROM customer_store_entry target
                 WHERE target.customerId = source.customerId AND target.channelId = ?
             )
             ORDER BY source.customerId${lock ? ' FOR UPDATE' : ''}`,
            [source.id, target.id],
        );
    }

    const rolePlaceholders = REQUIRED_TARGET_ROLE_CODES.map(() => '?').join(', ');
    const [requiredRoleRows] = await connection.execute(
        `SELECT id, code FROM role WHERE code IN (${rolePlaceholders})
         ORDER BY code${lock ? ' FOR UPDATE' : ''}`,
        REQUIRED_TARGET_ROLE_CODES,
    );
    assert.equal(
        requiredRoleRows.length,
        REQUIRED_TARGET_ROLE_CODES.length,
        'Required built-in roles are missing',
    );
    const requiredRoleIds = requiredRoleRows.map(row => String(row.id));
    const missingTargetRoleIds = await selectIds(
        connection,
        `SELECT roleItem.id
         FROM role roleItem
         WHERE roleItem.code IN (${rolePlaceholders}) AND NOT EXISTS (
             SELECT 1 FROM role_channels_channel relation
             WHERE relation.roleId = roleItem.id AND relation.channelId = ?
         )
         ORDER BY roleItem.code${lock ? ' FOR UPDATE' : ''}`,
        [...REQUIRED_TARGET_ROLE_CODES, target.id],
    );

    const movedRows = {};
    const existingTargetRowCounts = {};
    for (const table of MOVED_CHANNEL_TABLES) {
        if (
            !(await tableExists(connection, table)) ||
            !(await columnExists(connection, table, 'channelId'))
        ) {
            movedRows[table] = [];
            existingTargetRowCounts[table] = 0;
            continue;
        }
        const sourceRows = await selectIds(
            connection,
            `SELECT id FROM ${quoted(table)} WHERE channelId = ? ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
            [source.id],
        );
        const targetRows = await selectIds(
            connection,
            `SELECT id FROM ${quoted(table)} WHERE channelId = ? ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
            [target.id],
        );
        assertMoveTargetAvailable(table, sourceRows, targetRows);
        movedRows[table] = sourceRows;
        existingTargetRowCounts[table] = targetRows.length;
    }
    assert.ok(
        movedRows.storefront_content_block.length + existingTargetRowCounts.storefront_content_block > 0,
        'MOYAO storefront content is missing from both source and target Channels',
    );

    const orderSalesOwnerIds = await selectIds(
        connection,
        `SELECT item.id FROM \`order\` item
         WHERE item.salesChannelId = ? AND NOT EXISTS (
             SELECT 1 FROM order_channels_channel relation
             INNER JOIN channel channelItem ON channelItem.id = relation.channelId
             WHERE relation.orderId = item.id
               AND channelItem.code NOT IN (?, ?)
         )
         ORDER BY item.id${lock ? ' FOR UPDATE' : ''}`,
        [source.id, SOURCE_CHANNEL_CODE, TARGET_CHANNEL_CODE],
    );
    const sourceOrderMembershipIds = await selectIds(
        connection,
        `SELECT orderId AS id FROM order_channels_channel
         WHERE channelId = ? ORDER BY orderId${lock ? ' FOR UPDATE' : ''}`,
        [source.id],
    );
    const [ambiguousOrderRows] = await connection.execute(
        `SELECT COUNT(*) AS value FROM \`order\` item
         WHERE item.salesChannelId = ? AND EXISTS (
             SELECT 1 FROM order_channels_channel relation
             INNER JOIN channel channelItem ON channelItem.id = relation.channelId
             WHERE relation.orderId = item.id
               AND channelItem.code NOT IN (?, ?)
         )`,
        [source.id, SOURCE_CHANNEL_CODE, TARGET_CHANNEL_CODE],
    );
    assert.equal(
        Number(ambiguousOrderRows[0]?.value ?? -1),
        0,
        'A default-owned order already belongs to another public store',
    );

    const profileValues = Object.fromEntries(PROFILE_COLUMNS.map(column => [column, sourceProfile[column]]));
    const targetProfileValues = Object.fromEntries(
        PROFILE_COLUMNS.map(column => [column, targetProfile[column]]),
    );
    const sourceSellerOtherChannelIds = await selectIds(
        connection,
        `SELECT id FROM channel WHERE sellerId = ? AND id NOT IN (?, ?)
         ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
        [source.sellerId, source.id, target.id],
    );
    const targetSellerOtherChannelIds =
        target.sellerId && target.sellerId !== source.sellerId
            ? await selectIds(
                  connection,
                  `SELECT id FROM channel WHERE sellerId = ? AND id NOT IN (?, ?)
                   ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
                  [target.sellerId, source.id, target.id],
              )
            : [];
    const migrationStillHasSourceBusinessData =
        Object.values(sourceRelationEntityIds).some(ids => ids.length > 0) ||
        Object.values(movedRows).some(ids => ids.length > 0) ||
        sourceCustomerStoreEntryIds.length > 0 ||
        sourceOrderMembershipIds.length > 0 ||
        orderSalesOwnerIds.length > 0 ||
        migrationDigest(targetProfileValues) !== migrationDigest(profileValues) ||
        Number(targetSettings.heroAutoplayIntervalSeconds) !==
            Number(sourceSettings.heroAutoplayIntervalSeconds);
    const sellerSeparationAction =
        source.sellerId === target.sellerId
            ? 'CREATE_PLATFORM_SELLER'
            : migrationStillHasSourceBusinessData
              ? 'SWAP_EXISTING_SELLERS'
              : 'NONE';
    return {
        sourceChannelId: source.id,
        targetChannelId: target.id,
        sourceSellerId: source.sellerId,
        targetSellerId: target.sellerId,
        sourceSellerOtherChannelIds,
        targetSellerOtherChannelIds,
        sellerSeparationAction,
        sourceProfileVersion: sourceProfile.updatedAt,
        targetProfileVersion: targetProfile.updatedAt,
        profileDigest: migrationDigest(profileValues),
        targetProfileDigest: migrationDigest(targetProfileValues),
        relationEntityIds,
        sourceRelationEntityIds,
        crossStoreRelationEntityIds,
        copiedEntityIds,
        requiredRoleIds,
        missingTargetRoleIds,
        sourceCustomerStoreEntryIds,
        movedRows,
        existingTargetRowCounts,
        orderSalesOwnerIds,
        sourceOrderMembershipIds,
        sourceHeroAutoplayIntervalSeconds: Number(sourceSettings.heroAutoplayIntervalSeconds),
        targetHeroAutoplayIntervalSeconds: Number(targetSettings.heroAutoplayIntervalSeconds),
    };
}

async function readPlan(environment) {
    const connection = await connect(environment);
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('SET SESSION TRANSACTION READ ONLY');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        return publicMigrationPlan(await collectDetails(connection));
    } finally {
        try {
            await connection.query('ROLLBACK');
        } finally {
            await connection.end();
        }
    }
}

async function applyMigration(environment, expectedDigest) {
    assert.match(expectedDigest, /^[a-f0-9]{64}$/u, 'An exact reviewed operation digest is required');
    const connection = await connect(environment);
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await connection.beginTransaction();
        const details = await collectDetails(connection, true);
        const reviewed = publicMigrationPlan(details);
        assert.equal(
            reviewed.operationDigest,
            expectedDigest,
            'MOYAO migration state changed after review; rerun the read-only plan',
        );
        const crossStoreConflicts = Object.entries(details.crossStoreRelationEntityIds).filter(
            ([, ids]) => ids.length > 0,
        );
        assert.deepEqual(
            crossStoreConflicts,
            [],
            'Default-owned resources also belong to another operating store; clone them before migration',
        );
        assert.equal(
            details.sourceSellerOtherChannelIds.length + details.targetSellerOtherChannelIds.length,
            0,
            'A migration Seller is already used by another operating store',
        );

        if (details.missingTargetRoleIds.length > 0) {
            const rolePlaceholders = REQUIRED_TARGET_ROLE_CODES.map(() => '?').join(', ');
            const [roleResult] = await connection.execute(
                `INSERT INTO role_channels_channel (roleId, channelId)
                 SELECT roleItem.id, ? FROM role roleItem
                 WHERE roleItem.code IN (${rolePlaceholders}) AND NOT EXISTS (
                     SELECT 1 FROM role_channels_channel relation
                     WHERE relation.roleId = roleItem.id AND relation.channelId = ?
                 )`,
                [details.targetChannelId, ...REQUIRED_TARGET_ROLE_CODES, details.targetChannelId],
            );
            assert.equal(
                roleResult.affectedRows,
                details.missingTargetRoleIds.length,
                'Required target role assignment count drifted',
            );
        }

        for (const [table, entityColumn] of RELATION_TABLES) {
            if (details.relationEntityIds[table].length > 0) {
                const [insertResult] = await connection.execute(
                    `INSERT INTO ${quoted(table)} (${quoted(entityColumn)}, channelId)
                     SELECT source.${quoted(entityColumn)}, ? FROM ${quoted(table)} source
                     WHERE source.channelId = ? AND NOT EXISTS (
                         SELECT 1 FROM ${quoted(table)} target
                         WHERE target.${quoted(entityColumn)} = source.${quoted(entityColumn)}
                           AND target.channelId = ?
                     )`,
                    [details.targetChannelId, details.sourceChannelId, details.targetChannelId],
                );
                assert.equal(
                    insertResult.affectedRows,
                    details.relationEntityIds[table].length,
                    `${table} target relation count drifted`,
                );
            }
            if (details.sourceRelationEntityIds[table].length > 0) {
                const [deleteResult] = await connection.execute(
                    `DELETE FROM ${quoted(table)} WHERE channelId = ?`,
                    [details.sourceChannelId],
                );
                assert.equal(
                    deleteResult.affectedRows,
                    details.sourceRelationEntityIds[table].length,
                    `${table} default relation count drifted`,
                );
            }
        }

        if (details.copiedEntityIds.customer_store_entry.length > 0) {
            const [copyResult] = await connection.execute(
                `INSERT INTO customer_store_entry
                    (createdAt, updatedAt, customerId, channelId, firstSeenAt, source)
                 SELECT source.createdAt, source.updatedAt, source.customerId, ?,
                        source.firstSeenAt, source.source
                 FROM customer_store_entry source
                 WHERE source.channelId = ? AND NOT EXISTS (
                     SELECT 1 FROM customer_store_entry target
                     WHERE target.customerId = source.customerId AND target.channelId = ?
                 )`,
                [details.targetChannelId, details.sourceChannelId, details.targetChannelId],
            );
            assert.equal(
                copyResult.affectedRows,
                details.copiedEntityIds.customer_store_entry.length,
                'Customer store-entry count drifted during migration',
            );
        }
        if (details.sourceCustomerStoreEntryIds.length > 0) {
            await connection.execute(
                `UPDATE customer_store_entry target
                 INNER JOIN customer_store_entry source
                    ON source.customerId = target.customerId AND source.channelId = ?
                 SET target.createdAt = LEAST(target.createdAt, source.createdAt),
                     target.updatedAt = GREATEST(target.updatedAt, source.updatedAt),
                     target.firstSeenAt = CASE
                         WHEN target.firstSeenAt IS NULL THEN source.firstSeenAt
                         WHEN source.firstSeenAt IS NULL THEN target.firstSeenAt
                         ELSE LEAST(target.firstSeenAt, source.firstSeenAt)
                     END
                 WHERE target.channelId = ?`,
                [details.sourceChannelId, details.targetChannelId],
            );
            const [deleteResult] = await connection.execute(
                'DELETE FROM customer_store_entry WHERE channelId = ?',
                [details.sourceChannelId],
            );
            assert.equal(
                deleteResult.affectedRows,
                details.sourceCustomerStoreEntryIds.length,
                'Default customer store-entry count drifted during migration',
            );
        }

        if (details.orderSalesOwnerIds.length > 0) {
            await connection.execute(
                `INSERT INTO order_channels_channel (orderId, channelId)
                 SELECT item.id, ? FROM \`order\` item
                 WHERE item.salesChannelId = ? AND NOT EXISTS (
                     SELECT 1 FROM order_channels_channel target
                     WHERE target.orderId = item.id AND target.channelId = ?
                 )`,
                [details.targetChannelId, details.sourceChannelId, details.targetChannelId],
            );
            const [orderResult] = await connection.execute(
                'UPDATE `order` SET salesChannelId = ? WHERE salesChannelId = ?',
                [details.targetChannelId, details.sourceChannelId],
            );
            assert.equal(
                orderResult.affectedRows,
                details.orderSalesOwnerIds.length,
                'Default-owned order count drifted during migration',
            );
        }
        if (details.sourceOrderMembershipIds.length > 0) {
            const [deleteResult] = await connection.execute(
                'DELETE FROM order_channels_channel WHERE channelId = ?',
                [details.sourceChannelId],
            );
            assert.equal(
                deleteResult.affectedRows,
                details.sourceOrderMembershipIds.length,
                'Default order membership count drifted during migration',
            );
        }

        if (details.sellerSeparationAction === 'SWAP_EXISTING_SELLERS') {
            assert.ok(details.targetSellerId, 'MOYAO Channel requires its placeholder Seller');
            const [targetSellerResult] = await connection.execute(
                `UPDATE channel SET sellerId = ?, updatedAt = CURRENT_TIMESTAMP(6)
                 WHERE id = ? AND sellerId <=> ?`,
                [details.sourceSellerId, details.targetChannelId, details.targetSellerId],
            );
            assert.equal(
                targetSellerResult.affectedRows,
                1,
                'MOYAO Channel Seller was not updated exactly once',
            );
            const [sourceSellerResult] = await connection.execute(
                `UPDATE channel SET sellerId = ?, updatedAt = CURRENT_TIMESTAMP(6)
                 WHERE id = ? AND sellerId <=> ?`,
                [details.targetSellerId, details.sourceChannelId, details.sourceSellerId],
            );
            assert.equal(
                sourceSellerResult.affectedRows,
                1,
                'Platform Channel Seller was not updated exactly once',
            );
        } else if (details.sellerSeparationAction === 'CREATE_PLATFORM_SELLER') {
            const [insertSellerResult] = await connection.execute(
                `INSERT INTO seller (createdAt, updatedAt, deletedAt, name)
                 VALUES (CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6), NULL, ?)`,
                ['Platform Management'],
            );
            assert.ok(insertSellerResult.insertId, 'Platform Seller was not created');
            const [sourceSellerResult] = await connection.execute(
                `UPDATE channel SET sellerId = ?, updatedAt = CURRENT_TIMESTAMP(6)
                 WHERE id = ? AND sellerId <=> ?`,
                [insertSellerResult.insertId, details.sourceChannelId, details.sourceSellerId],
            );
            assert.equal(
                sourceSellerResult.affectedRows,
                1,
                'Platform Channel Seller was not separated exactly once',
            );
        }

        const profileAssignments = PROFILE_COLUMNS.map(
            column => `target.${quoted(column)} = source.${quoted(column)}`,
        );
        profileAssignments.push('target.updatedAt = CURRENT_TIMESTAMP(6)');
        const [profileResult] = await connection.execute(
            `UPDATE store_profile target JOIN store_profile source ON source.channelId = ?
             SET ${profileAssignments.join(', ')} WHERE target.channelId = ?`,
            [details.sourceChannelId, details.targetChannelId],
        );
        assert.equal(profileResult.affectedRows, 1, 'Target StoreProfile was not updated exactly once');

        const [settingsResult] = await connection.execute(
            `UPDATE storefront_content_settings target
             JOIN storefront_content_settings source ON source.channelId = ?
             SET target.heroAutoplayIntervalSeconds = source.heroAutoplayIntervalSeconds,
                 target.updatedAt = CURRENT_TIMESTAMP(6)
             WHERE target.channelId = ?`,
            [details.sourceChannelId, details.targetChannelId],
        );
        assert.equal(settingsResult.affectedRows, 1, 'Target content settings were not updated exactly once');

        for (const table of MOVED_CHANNEL_TABLES) {
            if (details.movedRows[table].length === 0) continue;
            const [result] = await connection.execute(
                `UPDATE ${quoted(table)} SET channelId = ? WHERE channelId = ?`,
                [details.targetChannelId, details.sourceChannelId],
            );
            assert.equal(result.affectedRows, details.movedRows[table].length, `${table} count drifted`);
        }

        await connection.commit();
        return reviewed;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

async function verifyMigration(environment) {
    const connection = await connect(environment);
    try {
        const source = await selectChannel(connection, SOURCE_CHANNEL_CODE, false);
        const target = await selectChannel(connection, TARGET_CHANNEL_CODE, false);
        assert.ok(source.sellerId, 'Platform Channel requires a Seller');
        assert.ok(target.sellerId, 'MOYAO Channel requires a Seller');
        assert.notEqual(target.sellerId, source.sellerId, 'Platform and MOYAO must use separate Sellers');
        const [sellerShareRows] = await connection.execute(
            `SELECT sellerId, COUNT(*) AS value FROM channel
             WHERE sellerId IN (?, ?) GROUP BY sellerId HAVING COUNT(*) > 1`,
            [source.sellerId, target.sellerId],
        );
        assert.equal(sellerShareRows.length, 0, 'Platform or MOYAO Seller is shared with another Channel');
        const rolePlaceholders = REQUIRED_TARGET_ROLE_CODES.map(() => '?').join(', ');
        const [targetRoleRows] = await connection.execute(
            `SELECT COUNT(DISTINCT roleItem.id) AS value
             FROM role roleItem
             INNER JOIN role_channels_channel relation ON relation.roleId = roleItem.id
             WHERE roleItem.code IN (${rolePlaceholders}) AND relation.channelId = ?`,
            [...REQUIRED_TARGET_ROLE_CODES, target.id],
        );
        assert.equal(
            Number(targetRoleRows[0]?.value ?? -1),
            REQUIRED_TARGET_ROLE_CODES.length,
            'MOYAO Channel is missing required SuperAdmin or customer role access',
        );
        const sourceProfile = await selectProfile(connection, source.id, false);
        const targetProfile = await selectProfile(connection, target.id, false);
        const sourceProfileValues = Object.fromEntries(
            PROFILE_COLUMNS.map(column => [column, sourceProfile[column]]),
        );
        const targetProfileValues = Object.fromEntries(
            PROFILE_COLUMNS.map(column => [column, targetProfile[column]]),
        );
        assert.equal(
            migrationDigest(targetProfileValues),
            migrationDigest(sourceProfileValues),
            'MOYAO StoreProfile does not match the reviewed default profile',
        );
        const [settingsRows] = await connection.execute(
            `SELECT channelId, heroAutoplayIntervalSeconds FROM storefront_content_settings
             WHERE channelId IN (?, ?) ORDER BY channelId`,
            [source.id, target.id],
        );
        const sourceSettings = settingsRows.find(row => String(row.channelId) === source.id);
        const targetSettings = settingsRows.find(row => String(row.channelId) === target.id);
        assert.equal(
            Number(targetSettings?.heroAutoplayIntervalSeconds),
            Number(sourceSettings?.heroAutoplayIntervalSeconds),
            'MOYAO content settings do not match the default storefront',
        );
        const sourceBlocks = await selectIds(
            connection,
            'SELECT id FROM storefront_content_block WHERE channelId = ? ORDER BY id',
            [source.id],
        );
        const targetBlocks = await selectIds(
            connection,
            'SELECT id FROM storefront_content_block WHERE channelId = ? ORDER BY id',
            [target.id],
        );
        assert.equal(sourceBlocks.length, 0, 'Default Channel still owns storefront content blocks');
        assert.ok(targetBlocks.length > 0, 'MOYAO Channel has no storefront content blocks');
        for (const [table] of RELATION_TABLES) {
            const [rows] = await connection.execute(
                `SELECT COUNT(*) AS value FROM ${quoted(table)} WHERE channelId = ?`,
                [source.id],
            );
            assert.equal(Number(rows[0]?.value ?? -1), 0, `${table} still belongs to the default Channel`);
        }
        if (await tableExists(connection, 'customer_store_entry')) {
            const [rows] = await connection.execute(
                'SELECT COUNT(*) AS value FROM customer_store_entry WHERE channelId = ?',
                [source.id],
            );
            assert.equal(
                Number(rows[0]?.value ?? -1),
                0,
                'Customer store-entry history still belongs to the default Channel',
            );
        }
        for (const table of MOVED_CHANNEL_TABLES) {
            if (
                !(await tableExists(connection, table)) ||
                !(await columnExists(connection, table, 'channelId'))
            ) {
                continue;
            }
            const [rows] = await connection.execute(
                `SELECT COUNT(*) AS value FROM ${quoted(table)} WHERE channelId = ?`,
                [source.id],
            );
            assert.equal(Number(rows[0]?.value ?? -1), 0, `${table} still belongs to the default Channel`);
        }
        const [sourceOrderRows] = await connection.execute(
            'SELECT COUNT(*) AS value FROM `order` WHERE salesChannelId = ?',
            [source.id],
        );
        assert.equal(
            Number(sourceOrderRows[0]?.value ?? -1),
            0,
            'Default Channel still owns historical sales',
        );
        const [sourceOrderMembershipRows] = await connection.execute(
            'SELECT COUNT(*) AS value FROM order_channels_channel WHERE channelId = ?',
            [source.id],
        );
        assert.equal(
            Number(sourceOrderMembershipRows[0]?.value ?? -1),
            0,
            'Default Channel still has order memberships',
        );
        const [orderMembershipRows] = await connection.execute(
            `SELECT COUNT(*) AS value FROM \`order\` item
             WHERE item.salesChannelId = ? AND NOT EXISTS (
                 SELECT 1 FROM order_channels_channel relation
                 WHERE relation.orderId = item.id AND relation.channelId = ?
             )`,
            [target.id, target.id],
        );
        assert.equal(
            Number(orderMembershipRows[0]?.value ?? -1),
            0,
            'A MOYAO-owned order is missing the MOYAO Channel membership',
        );
        return {
            format: 1,
            schema: 'vendure-moyao-default-store-migration-verification',
            sourceChannelCode: SOURCE_CHANNEL_CODE,
            targetChannelCode: TARGET_CHANNEL_CODE,
            targetContentBlockCount: targetBlocks.length,
            relationTablesVerified: RELATION_TABLES.length,
            copiedChannelTablesVerified: 1,
            movedChannelTablesVerified: MOVED_CHANNEL_TABLES.length,
            defaultOwnedOrderCount: 0,
            defaultOrderMembershipCount: 0,
            defaultRelationCount: 0,
            defaultCustomerStoreEntryCount: 0,
            profileMatches: true,
            contentSettingsMatch: true,
            sellerSeparated: true,
            targetRequiredRoleCount: REQUIRED_TARGET_ROLE_CODES.length,
        };
    } finally {
        await connection.end();
    }
}

async function main() {
    const [operation, expectedDigest = ''] = process.argv.slice(2);
    assert.ok(
        ['plan', 'apply', 'verify'].includes(operation),
        'Usage: moyao-default-store-migration.mjs plan|apply|verify [digest]',
    );
    const result =
        operation === 'plan'
            ? await readPlan(process.env)
            : operation === 'apply'
              ? await applyMigration(process.env, expectedDigest)
              : await verifyMigration(process.env);
    process.stdout.write(`MOYAO_DEFAULT_STORE_${operation.toUpperCase()} ${JSON.stringify(result)}\n`);
    process.stdout.write(`MOYAO_DEFAULT_STORE_MIGRATION_OK operation=${operation}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch(error => {
        process.stderr.write(
            `${error instanceof Error ? error.message : 'MOYAO default store migration failed'}\n`,
        );
        process.exitCode = 1;
    });
}
