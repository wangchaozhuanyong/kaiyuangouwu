import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

const variantModeColumn = 'customFieldsDigitaldeliverymode';
const orderLineModeColumn = 'customFieldsDigitaldeliverymodesnapshot';

export class AddAutoCardDelivery1787594400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.addCustomFieldColumns(queryRunner);

        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const now = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : databaseType === 'sqlite' || databaseType === 'better-sqlite3'
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        const nullableDate = (name: string): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            isNullable: true,
        });
        const id = (): TableColumnOptions => ({
            name: 'id',
            type: idType,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
        });

        if (!(await queryRunner.hasTable('auto_card_config'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'auto_card_config',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'enabled', type: 'boolean', default: true },
                        { name: 'formatName', type: 'varchar', length: '80' },
                        { name: 'delimiter', type: 'varchar', length: '16', default: "'----'" },
                        { name: 'fieldsJson', type: 'text' },
                        { name: 'instructions', type: 'text' },
                        { name: 'lowStockThreshold', type: 'int', default: 5 },
                        { name: 'channelId', type: idType },
                        { name: 'productVariantId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_auto_card_config_channel_variant',
                            columnNames: ['channelId', 'productVariantId'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_auto_card_config_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_auto_card_config_variant',
                            columnNames: ['productVariantId'],
                            referencedTableName: 'product_variant',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('auto_card_delivery'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'auto_card_delivery',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'state', type: 'varchar', length: '24', default: "'WAITING_STOCK'" },
                        { name: 'recipientEmail', type: 'varchar', length: '254' },
                        { name: 'languageCode', type: 'varchar', length: '16' },
                        { name: 'productName', type: 'varchar', length: '255' },
                        { name: 'sku', type: 'varchar', length: '255' },
                        { name: 'quantity', type: 'int' },
                        { name: 'schemaSnapshot', type: 'text' },
                        { name: 'instructionsSnapshot', type: 'text' },
                        { name: 'attemptCount', type: 'int', default: 0 },
                        { name: 'lastError', type: 'text', isNullable: true },
                        nullableDate('lastDispatchedAt'),
                        nullableDate('sentAt'),
                        { name: 'fulfillmentId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'channelId', type: idType },
                        { name: 'orderId', type: idType },
                        { name: 'orderLineId', type: idType },
                        { name: 'configId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_auto_card_delivery_order_line',
                            columnNames: ['orderLineId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_auto_card_delivery_channel_state_created',
                            columnNames: ['channelId', 'state', 'createdAt'],
                        },
                        {
                            name: 'IDX_auto_card_delivery_config_created',
                            columnNames: ['configId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_auto_card_delivery_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_auto_card_delivery_order',
                            columnNames: ['orderId'],
                            referencedTableName: 'order',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_auto_card_delivery_order_line',
                            columnNames: ['orderLineId'],
                            referencedTableName: 'order_line',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_auto_card_delivery_config',
                            columnNames: ['configId'],
                            referencedTableName: 'auto_card_config',
                            referencedColumnNames: ['id'],
                            onDelete: 'RESTRICT',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('auto_card_pool_item'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'auto_card_pool_item',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'state', type: 'varchar', length: '16', default: "'AVAILABLE'" },
                        { name: 'sequence', type: 'int' },
                        { name: 'encryptedPayload', type: 'text' },
                        { name: 'fingerprint', type: 'varchar', length: '64' },
                        nullableDate('assignedAt'),
                        { name: 'disabledReason', type: 'text', isNullable: true },
                        { name: 'configId', type: idType },
                        { name: 'deliveryId', type: idType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_auto_card_pool_config_state_sequence',
                            columnNames: ['configId', 'state', 'sequence'],
                        },
                        {
                            name: 'IDX_auto_card_pool_config_fingerprint',
                            columnNames: ['configId', 'fingerprint'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_auto_card_pool_config_sequence',
                            columnNames: ['configId', 'sequence'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_auto_card_pool_config',
                            columnNames: ['configId'],
                            referencedTableName: 'auto_card_config',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_auto_card_pool_delivery',
                            columnNames: ['deliveryId'],
                            referencedTableName: 'auto_card_delivery',
                            referencedColumnNames: ['id'],
                            onDelete: 'SET NULL',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('auto_card_delivery_event'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'auto_card_delivery_event',
                    columns: [
                        id(),
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'type', type: 'varchar', length: '24' },
                        { name: 'actorType', type: 'varchar', length: '16' },
                        { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'note', type: 'text' },
                        { name: 'deliveryId', type: idType },
                    ],
                    indices: [
                        {
                            name: 'IDX_auto_card_delivery_event_delivery_created',
                            columnNames: ['deliveryId', 'createdAt'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_auto_card_delivery_event_delivery',
                            columnNames: ['deliveryId'],
                            referencedTableName: 'auto_card_delivery',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of [
            'auto_card_delivery_event',
            'auto_card_pool_item',
            'auto_card_delivery',
            'auto_card_config',
        ]) {
            if (await queryRunner.hasTable(tableName)) {
                await queryRunner.dropTable(tableName, true);
            }
        }
        const orderLine = await queryRunner.getTable('order_line');
        if (orderLine?.findColumnByName(orderLineModeColumn)) {
            await queryRunner.dropColumn('order_line', orderLineModeColumn);
        }
        const productVariant = await queryRunner.getTable('product_variant');
        if (productVariant?.findColumnByName(variantModeColumn)) {
            await queryRunner.dropColumn('product_variant', variantModeColumn);
        }
    }

    private async addCustomFieldColumns(queryRunner: QueryRunner): Promise<void> {
        const productVariant = await queryRunner.getTable('product_variant');
        if (!productVariant?.findColumnByName(variantModeColumn)) {
            await queryRunner.addColumn(
                'product_variant',
                new TableColumn({
                    name: variantModeColumn,
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                    default: "'file_download'",
                }),
            );
        }
        const orderLine = await queryRunner.getTable('order_line');
        if (!orderLine?.findColumnByName(orderLineModeColumn)) {
            await queryRunner.addColumn(
                'order_line',
                new TableColumn({
                    name: orderLineModeColumn,
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                    default: "'file_download'",
                }),
            );
        }
    }
}
