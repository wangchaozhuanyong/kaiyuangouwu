import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

/** Additive only. Existing inventory, files and order records are never rewritten here. */
export class AddDigitalProductDomains1791086400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const driver = queryRunner.connection.options.type;
        const mysql = ['mysql', 'mariadb'].includes(driver);
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(driver);
        const integer = sqlite || driver === 'postgres' ? 'integer' : 'int';
        const date = driver === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const id = (name: string, nullable = false): TableColumnOptions => ({
            name,
            type: integer,
            isNullable: nullable,
        });
        const number = (name: string, value?: number): TableColumnOptions => ({
            name,
            type: integer,
            ...(value === undefined ? {} : { default: value }),
        });
        const text = (name: string, length: number, value?: string): TableColumnOptions => ({
            name,
            type: 'varchar',
            length: String(length),
            ...(value === undefined ? {} : { default: `'${value}'` }),
        });
        const base: TableColumnOptions[] = [
            {
                name: 'id',
                type: integer,
                isGenerated: true,
                generationStrategy: 'increment',
                isPrimary: true,
            },
            ...['createdAt', 'updatedAt'].map(name => ({
                name,
                type: date,
                ...(mysql ? { precision: 6 } : {}),
                default: mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP',
                ...(mysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
            })),
        ];
        const tables = [
            new Table({
                name: 'physical_return_receipt',
                columns: [
                    ...base,
                    id('channelId'),
                    id('requestId'),
                    id('orderId'),
                    id('orderLineId'),
                    id('stockLocationId'),
                    text('idempotencyKey', 80),
                    number('quantity'),
                    text('quality', 16),
                    text('state', 16),
                    { ...text('actorId', 64), isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_physical_return_key',
                        columnNames: ['channelId', 'idempotencyKey'],
                        isUnique: true,
                    },
                    { name: 'IDX_physical_return_line', columnNames: ['channelId', 'orderLineId'] },
                ],
            }),
            new Table({
                name: 'digital_receipt_access',
                columns: [
                    ...base,
                    id('channelId'),
                    id('orderId'),
                    id('orderLineId'),
                    number('claimedQuantity'),
                    { ...text('actorId', 64), isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_digital_receipt_line',
                        columnNames: ['channelId', 'orderLineId'],
                        isUnique: true,
                    },
                ],
            }),
            new Table({
                name: 'checkout_resource_hold',
                columns: [
                    ...base,
                    id('channelId'),
                    id('orderId'),
                    text('state', 24, 'HELD'),
                    { name: 'expiresAt', type: date },
                    { ...text('reviewReason', 1000), isNullable: true },
                ],
                indices: [{ name: 'IDX_checkout_resource_order', columnNames: ['orderId'], isUnique: true }],
            }),
            new Table({
                name: 'digital_variant_config',
                columns: [
                    ...base,
                    id('channelId'),
                    id('productVariantId'),
                    text('deliveryMode', 24),
                    text('stockPolicy', 24),
                    number('availableQuantity', 0),
                    id('fileVersionId', true),
                    text('migrationState', 24, 'ACTIVE'),
                ],
                indices: [
                    {
                        name: 'IDX_digital_config_channel_variant',
                        columnNames: ['channelId', 'productVariantId'],
                        isUnique: true,
                    },
                ],
            }),
            new Table({
                name: 'digital_order_reservation',
                columns: [
                    ...base,
                    id('channelId'),
                    id('orderId'),
                    id('orderLineId'),
                    id('configId'),
                    text('deliveryMode', 24),
                    text('stockPolicy', 24),
                    number('quantity'),
                    number('releasedQuantity', 0),
                    number('consumedQuantity', 0),
                    text('state', 24, 'HELD'),
                    { name: 'expiresAt', type: date },
                    { name: 'poolItemIdsJson', type: 'text', default: "('[]')" },
                    id('fileVersionId', true),
                ],
                indices: [
                    { name: 'IDX_digital_reservation_line', columnNames: ['orderLineId'], isUnique: true },
                    { name: 'IDX_digital_reservation_expiry', columnNames: ['state', 'expiresAt'] },
                ],
            }),
            new Table({
                name: 'digital_quota_movement',
                columns: [
                    ...base,
                    id('channelId'),
                    id('productVariantId'),
                    text('eventKey', 160),
                    text('type', 24),
                    number('quantity'),
                    number('availableAfter'),
                    { ...text('actorId', 64), isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_digital_quota_event',
                        columnNames: ['channelId', 'eventKey'],
                        isUnique: true,
                    },
                ],
            }),
            new Table({
                name: 'digital_file_version',
                columns: [
                    ...base,
                    id('channelId'),
                    text('fileName', 255),
                    text('storageKey', 255),
                    number('size'),
                    text('sha256', 64),
                ],
                indices: [{ name: 'IDX_digital_file_channel', columnNames: ['channelId'] }],
            }),
        ];
        if (
            (await queryRunner.hasTable('packaging_unpack_event')) &&
            !(await queryRunner.hasColumn('packaging_unpack_event', 'lotTransfersJson'))
        )
            await queryRunner.addColumn(
                'packaging_unpack_event',
                new TableColumn({ name: 'lotTransfersJson', type: 'text', default: "('[]')" }),
            );
        for (const table of tables)
            if (!(await queryRunner.hasTable(table.name))) await queryRunner.createTable(table);
    }
    async down(): Promise<void> {
        // Keep additive tables and transaction history when rolling application code back.
    }
}
