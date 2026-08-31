import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

export class AddCommerceModeAndManualDelivery1787914800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.addCustomFields(queryRunner);
        await this.addAutoCardRawPayload(queryRunner);
        await this.createDeliveryEmailTable(queryRunner);
        await this.createManualDeliveryTable(queryRunner);
        await this.createManualDeliveryEventTable(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of [
            'manual_digital_delivery_event',
            'manual_digital_delivery',
            'customer_delivery_email',
        ]) {
            if (await queryRunner.hasTable(tableName)) {
                await queryRunner.dropTable(tableName, true);
            }
        }
        await this.dropColumn(queryRunner, 'auto_card_pool_item', 'encryptedRawPayload');
        for (const [tableName, columnName] of [
            ['channel', 'customFieldsCommercemode'],
            ['product', 'customFieldsFulfillmenttype'],
            ['product', 'customFieldsRefundpolicy'],
            ['product', 'customFieldsManualdeliveryslaminutes'],
            ['product_variant', 'customFieldsDigitalstockpolicy'],
            ['order', 'customFieldsDeliveryemailcontactid'],
            ['order_line', 'customFieldsRefundpolicysnapshot'],
            ['order_line', 'customFieldsManualdeliveryslaminutessnapshot'],
        ] as const) {
            await this.dropColumn(queryRunner, tableName, columnName);
        }
    }

    private async addCustomFields(queryRunner: QueryRunner): Promise<void> {
        await this.addColumn(queryRunner, 'channel', {
            name: 'customFieldsCommercemode',
            type: 'varchar',
            length: '255',
            default: "'DIGITAL_ONLY'",
        });
        await this.addColumn(queryRunner, 'product', {
            name: 'customFieldsFulfillmenttype',
            type: 'varchar',
            length: '255',
            default: "'digital'",
        });
        await this.addColumn(queryRunner, 'product', {
            name: 'customFieldsRefundpolicy',
            type: 'varchar',
            length: '255',
            default: "'MERCHANT_REVIEW'",
        });
        await this.addColumn(queryRunner, 'product', {
            name: 'customFieldsManualdeliveryslaminutes',
            type: 'int',
            default: 1440,
        });
        await this.addColumn(queryRunner, 'product_variant', {
            name: 'customFieldsDigitalstockpolicy',
            type: 'varchar',
            length: '255',
            default: "'limited'",
        });
        await this.addColumn(queryRunner, 'order', {
            name: 'customFieldsDeliveryemailcontactid',
            type: 'varchar',
            length: '64',
            isNullable: true,
        });
        await this.addColumn(queryRunner, 'order_line', {
            name: 'customFieldsRefundpolicysnapshot',
            type: 'varchar',
            length: '255',
            default: "'MERCHANT_REVIEW'",
        });
        await this.addColumn(queryRunner, 'order_line', {
            name: 'customFieldsManualdeliveryslaminutessnapshot',
            type: 'int',
            default: 1440,
        });
    }

    private async addAutoCardRawPayload(queryRunner: QueryRunner): Promise<void> {
        await this.addColumn(queryRunner, 'auto_card_pool_item', {
            name: 'encryptedRawPayload',
            type: 'text',
            isNullable: true,
        });
    }

    private async createDeliveryEmailTable(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('customer_delivery_email')) return;
        const helpers = this.tableHelpers(queryRunner);
        await queryRunner.createTable(
            new Table({
                name: 'customer_delivery_email',
                columns: [
                    helpers.id(),
                    helpers.timestamp('createdAt'),
                    helpers.timestamp('updatedAt'),
                    { name: 'emailAddress', type: 'varchar', length: '254' },
                    { name: 'normalizedEmail', type: 'varchar', length: '254' },
                    { name: 'label', type: 'varchar', length: '80', default: "''" },
                    { name: 'isDefault', type: 'boolean', default: false },
                    helpers.date('confirmedAt'),
                    { name: 'channelId', type: helpers.idType },
                    { name: 'customerId', type: helpers.idType },
                ],
                indices: [
                    {
                        name: 'IDX_customer_delivery_email_unique',
                        columnNames: ['channelId', 'customerId', 'normalizedEmail'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_customer_delivery_email_default',
                        columnNames: ['channelId', 'customerId', 'isDefault'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_delivery_email_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_delivery_email_customer',
                        columnNames: ['customerId'],
                        referencedTableName: 'customer',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    private async createManualDeliveryTable(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('manual_digital_delivery')) return;
        const helpers = this.tableHelpers(queryRunner);
        await queryRunner.createTable(
            new Table({
                name: 'manual_digital_delivery',
                columns: [
                    helpers.id(),
                    helpers.timestamp('createdAt'),
                    helpers.timestamp('updatedAt'),
                    { name: 'state', type: 'varchar', length: '24', default: "'WAITING_PROCESSING'" },
                    { name: 'recipientEmail', type: 'varchar', length: '254' },
                    { name: 'languageCode', type: 'varchar', length: '16' },
                    { name: 'productName', type: 'varchar', length: '255' },
                    { name: 'sku', type: 'varchar', length: '255' },
                    { name: 'quantity', type: 'int' },
                    helpers.date('expectedAt'),
                    { name: 'encryptedPackages', type: 'text', isNullable: true },
                    { name: 'attachmentAssetIdsJson', type: 'text' },
                    { name: 'attemptCount', type: 'int', default: 0 },
                    { name: 'lastError', type: 'text', isNullable: true },
                    helpers.date('lastDispatchedAt', true),
                    helpers.date('sentAt', true),
                    { name: 'fulfillmentId', type: 'varchar', length: '64', isNullable: true },
                    { name: 'channelId', type: helpers.idType },
                    { name: 'orderId', type: helpers.idType },
                    { name: 'orderLineId', type: helpers.idType },
                ],
                indices: [
                    {
                        name: 'IDX_manual_digital_delivery_order_line',
                        columnNames: ['orderLineId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_manual_digital_delivery_channel_state_expected',
                        columnNames: ['channelId', 'state', 'expectedAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_manual_delivery_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_manual_delivery_order',
                        columnNames: ['orderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_manual_delivery_order_line',
                        columnNames: ['orderLineId'],
                        referencedTableName: 'order_line',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    private async createManualDeliveryEventTable(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('manual_digital_delivery_event')) return;
        const helpers = this.tableHelpers(queryRunner);
        await queryRunner.createTable(
            new Table({
                name: 'manual_digital_delivery_event',
                columns: [
                    helpers.id(),
                    helpers.timestamp('createdAt'),
                    helpers.timestamp('updatedAt'),
                    { name: 'type', type: 'varchar', length: '24' },
                    { name: 'actorType', type: 'varchar', length: '16' },
                    { name: 'actorId', type: 'varchar', length: '64', isNullable: true },
                    { name: 'note', type: 'text' },
                    { name: 'deliveryId', type: helpers.idType },
                ],
                indices: [
                    {
                        name: 'IDX_manual_delivery_event_delivery_created',
                        columnNames: ['deliveryId', 'createdAt'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_manual_delivery_event_delivery',
                        columnNames: ['deliveryId'],
                        referencedTableName: 'manual_digital_delivery',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    private async addColumn(
        queryRunner: QueryRunner,
        tableName: string,
        options: TableColumnOptions,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (table && !table.findColumnByName(options.name)) {
            await queryRunner.addColumn(table, new TableColumn(options));
        }
    }

    private async dropColumn(queryRunner: QueryRunner, tableName: string, columnName: string): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (table?.findColumnByName(columnName)) {
            await queryRunner.dropColumn(table, columnName);
        }
    }

    private tableHelpers(queryRunner: QueryRunner) {
        const databaseType = queryRunner.connection.options.type;
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        return {
            idType,
            id: (): TableColumnOptions => ({
                name: 'id',
                type: idType,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            }),
            timestamp: (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
                name,
                type: dateType,
                ...(isMysql ? { precision: 6 } : {}),
                default: now,
                ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
            }),
            date: (name: string, isNullable = false): TableColumnOptions => ({
                name,
                type: dateType,
                ...(isMysql ? { precision: 6 } : {}),
                isNullable,
            }),
        };
    }
}
