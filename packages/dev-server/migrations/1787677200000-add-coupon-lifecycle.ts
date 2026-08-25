import {
    MigrationInterface,
    QueryRunner,
    Table,
    TableColumn,
    TableColumnOptions,
    TableForeignKey,
    TableIndex,
} from 'typeorm';

export class AddCouponLifecycle1787677200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const floatType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'double precision' : 'float';
        const now = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : databaseType === 'sqlite' || databaseType === 'better-sqlite3'
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        const optionalDate = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            isNullable: true,
        });
        const requiredDate = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
        });
        const id = (): TableColumnOptions => ({
            name: 'id',
            type: idType,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
        });

        if (!(await queryRunner.hasTable('store_coupon_campaign_config'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'store_coupon_campaign_config',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'channelId', type: idType },
                        { name: 'promotionId', type: idType },
                        optionalDate('claimStartsAt'),
                        optionalDate('claimEndsAt'),
                        { name: 'validityDays', type: 'int', isNullable: true },
                        { name: 'issueLimit', type: 'int', isNullable: true },
                        { name: 'perCustomerClaimLimit', type: 'int', default: 1 },
                        { name: 'stackPolicy', type: 'varchar', length: '16', default: "'EXCLUSIVE'" },
                        { name: 'returnOnCancellation', type: booleanType, default: booleanTrue },
                        { name: 'returnOnFullRefund', type: booleanType, default: booleanTrue },
                    ],
                    indices: [
                        {
                            name: 'IDX_store_coupon_campaign_config_promotion',
                            columnNames: ['promotionId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_store_coupon_campaign_config_channel_claim',
                            columnNames: ['channelId', 'claimStartsAt', 'claimEndsAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_store_coupon_config_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_store_coupon_config_promotion',
                            columnNames: ['promotionId'],
                            referencedTableName: 'promotion',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('customer_coupon'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'customer_coupon',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'channelId', type: idType },
                        { name: 'campaignConfigId', type: idType },
                        { name: 'promotionId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'status', type: 'varchar', length: '24', default: "'AVAILABLE'" },
                        { name: 'campaignName', type: 'varchar', length: '120' },
                        { name: 'campaignKind', type: 'varchar', length: '32' },
                        { name: 'minimumSpend', type: 'int', default: 0 },
                        { name: 'discountAmount', type: 'int', isNullable: true },
                        { name: 'discountRate', type: floatType, isNullable: true },
                        requiredDate('claimedAt'),
                        requiredDate('validFrom'),
                        optionalDate('validUntil'),
                        optionalDate('lockedAt'),
                        optionalDate('lockExpiresAt'),
                        { name: 'lockedOrderId', type: idType, isNullable: true },
                        optionalDate('usedAt'),
                        { name: 'usedOrderId', type: idType, isNullable: true },
                        optionalDate('returnedAt'),
                        optionalDate('expiredAt'),
                        optionalDate('revokedAt'),
                        { name: 'returnCount', type: 'int', default: 0 },
                        { name: 'version', type: 'int' },
                    ],
                    indices: [
                        {
                            name: 'IDX_customer_coupon_campaign_customer',
                            columnNames: ['promotionId', 'customerId', 'claimedAt'],
                        },
                        {
                            name: 'IDX_customer_coupon_customer_status_valid',
                            columnNames: ['customerId', 'status', 'validUntil'],
                        },
                        {
                            name: 'IDX_customer_coupon_locked_order',
                            columnNames: ['lockedOrderId', 'status'],
                        },
                        {
                            name: 'IDX_customer_coupon_used_order',
                            columnNames: ['usedOrderId', 'status'],
                        },
                    ],
                    foreignKeys: [
                        foreignKey('FK_customer_coupon_channel', 'channelId', 'channel', 'CASCADE'),
                        foreignKey(
                            'FK_customer_coupon_config',
                            'campaignConfigId',
                            'store_coupon_campaign_config',
                            'CASCADE',
                        ),
                        foreignKey('FK_customer_coupon_promotion', 'promotionId', 'promotion', 'CASCADE'),
                        foreignKey('FK_customer_coupon_customer', 'customerId', 'customer', 'CASCADE'),
                        foreignKey('FK_customer_coupon_locked_order', 'lockedOrderId', 'order', 'SET NULL'),
                        foreignKey('FK_customer_coupon_used_order', 'usedOrderId', 'order', 'SET NULL'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('coupon_ledger_entry'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'coupon_ledger_entry',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'channelId', type: idType },
                        { name: 'customerCouponId', type: idType },
                        { name: 'promotionId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'orderId', type: idType, isNullable: true },
                        { name: 'refundId', type: idType, isNullable: true },
                        { name: 'eventType', type: 'varchar', length: '24' },
                        { name: 'actorType', type: 'varchar', length: '16' },
                        { name: 'idempotencyKey', type: 'varchar', length: '255', isNullable: true },
                        { name: 'discountAmount', type: 'int', isNullable: true },
                        { name: 'note', type: 'varchar', length: '500', isNullable: true },
                        { name: 'metadata', type: 'text', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_coupon_ledger_channel_created',
                            columnNames: ['channelId', 'createdAt'],
                        },
                        {
                            name: 'IDX_coupon_ledger_coupon_created',
                            columnNames: ['customerCouponId', 'createdAt'],
                        },
                        {
                            name: 'IDX_coupon_ledger_campaign_created',
                            columnNames: ['promotionId', 'createdAt'],
                        },
                        {
                            name: 'IDX_coupon_ledger_idempotency',
                            columnNames: ['idempotencyKey'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        foreignKey('FK_coupon_ledger_channel', 'channelId', 'channel', 'CASCADE'),
                        foreignKey(
                            'FK_coupon_ledger_coupon',
                            'customerCouponId',
                            'customer_coupon',
                            'CASCADE',
                        ),
                        foreignKey('FK_coupon_ledger_promotion', 'promotionId', 'promotion', 'CASCADE'),
                        foreignKey('FK_coupon_ledger_customer', 'customerId', 'customer', 'CASCADE'),
                        foreignKey('FK_coupon_ledger_order', 'orderId', 'order', 'SET NULL'),
                        foreignKey('FK_coupon_ledger_refund', 'refundId', 'refund', 'SET NULL'),
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('coupon_order_allocation'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'coupon_order_allocation',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'channelId', type: idType },
                        { name: 'customerCouponId', type: idType },
                        { name: 'promotionId', type: idType },
                        { name: 'customerId', type: idType },
                        { name: 'orderId', type: idType },
                        { name: 'refundId', type: idType, isNullable: true },
                        { name: 'status', type: 'varchar', length: '16', default: "'LOCKED'" },
                        { name: 'campaignName', type: 'varchar', length: '120' },
                        { name: 'currencyCode', type: 'varchar', length: '3' },
                        { name: 'discountAmount', type: 'int', default: 0 },
                        { name: 'discountAmountWithTax', type: 'int', default: 0 },
                        { name: 'refundedAmount', type: 'int', default: 0 },
                        { name: 'orderTotalWithTax', type: 'int', default: 0 },
                        { name: 'lineAllocations', type: 'text', isNullable: true },
                        requiredDate('appliedAt'),
                        optionalDate('usedAt'),
                        optionalDate('releasedAt'),
                        optionalDate('refundedAt'),
                    ],
                    indices: [
                        {
                            name: 'IDX_coupon_allocation_order_coupon',
                            columnNames: ['orderId', 'customerCouponId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_coupon_allocation_campaign_created',
                            columnNames: ['promotionId', 'createdAt'],
                        },
                        {
                            name: 'IDX_coupon_allocation_customer_created',
                            columnNames: ['customerId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        foreignKey('FK_coupon_allocation_channel', 'channelId', 'channel', 'CASCADE'),
                        foreignKey(
                            'FK_coupon_allocation_coupon',
                            'customerCouponId',
                            'customer_coupon',
                            'CASCADE',
                        ),
                        foreignKey('FK_coupon_allocation_promotion', 'promotionId', 'promotion', 'CASCADE'),
                        foreignKey('FK_coupon_allocation_customer', 'customerId', 'customer', 'CASCADE'),
                        foreignKey('FK_coupon_allocation_order', 'orderId', 'order', 'CASCADE'),
                        foreignKey('FK_coupon_allocation_refund', 'refundId', 'refund', 'SET NULL'),
                    ],
                }),
                true,
            );
        }

        if (await queryRunner.hasTable('after_sales_request')) {
            const table = await queryRunner.getTable('after_sales_request');
            if (!table?.findColumnByName('refundId')) {
                await queryRunner.addColumn(
                    'after_sales_request',
                    new TableColumn({ name: 'refundId', type: idType, isNullable: true }),
                );
                await queryRunner.createIndex(
                    'after_sales_request',
                    new TableIndex({
                        name: 'IDX_after_sales_request_refund',
                        columnNames: ['refundId'],
                        isUnique: true,
                    }),
                );
                await queryRunner.createForeignKey(
                    'after_sales_request',
                    new TableForeignKey({
                        name: 'FK_after_sales_request_refund',
                        columnNames: ['refundId'],
                        referencedTableName: 'refund',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    }),
                );
            }
            if (!table?.findColumnByName('refundedAt')) {
                await queryRunner.addColumn(
                    'after_sales_request',
                    new TableColumn(optionalDate('refundedAt')),
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('after_sales_request')) {
            const table = await queryRunner.getTable('after_sales_request');
            const refundForeignKey = table?.foreignKeys.find(
                key => key.name === 'FK_after_sales_request_refund',
            );
            if (refundForeignKey) await queryRunner.dropForeignKey('after_sales_request', refundForeignKey);
            const refundIndex = table?.indices.find(index => index.name === 'IDX_after_sales_request_refund');
            if (refundIndex) await queryRunner.dropIndex('after_sales_request', refundIndex);
            if (table?.findColumnByName('refundedAt')) {
                await queryRunner.dropColumn('after_sales_request', 'refundedAt');
            }
            if (table?.findColumnByName('refundId')) {
                await queryRunner.dropColumn('after_sales_request', 'refundId');
            }
        }
        for (const tableName of [
            'coupon_order_allocation',
            'coupon_ledger_entry',
            'customer_coupon',
            'store_coupon_campaign_config',
        ]) {
            if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName, true);
        }
    }
}

function foreignKey(
    name: string,
    columnName: string,
    referencedTableName: string,
    onDelete: 'CASCADE' | 'SET NULL',
) {
    return {
        name,
        columnNames: [columnName],
        referencedTableName,
        referencedColumnNames: ['id'],
        onDelete,
    };
}
