import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddCustomerProductActivity1790310060000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('customer_product_activity')) return;
        const type = runner.connection.options.type;
        const mysql = type === 'mysql' || type === 'mariadb';
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        const idType = sqlite || type === 'postgres' ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        await runner.createTable(
            new Table({
                name: 'customer_product_activity',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    ...['createdAt', 'updatedAt'].map(name => ({
                        name,
                        type: dateType,
                        ...(mysql ? { precision: 6 } : {}),
                        default: mysql
                            ? 'CURRENT_TIMESTAMP(6)'
                            : sqlite
                              ? "datetime('now')"
                              : 'CURRENT_TIMESTAMP',
                        ...(mysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                    })),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'productId', type: idType },
                    { name: 'kind', type: 'varchar', length: '16' },
                    { name: 'visitedAt', type: dateType, ...(mysql ? { precision: 6 } : {}) },
                ],
                indices: [
                    {
                        name: 'UQ_customer_product_activity',
                        columnNames: ['channelId', 'customerId', 'kind', 'productId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_customer_product_activity_recent',
                        columnNames: ['channelId', 'customerId', 'kind', 'visitedAt'],
                    },
                ],
                foreignKeys: [
                    ['channel', 'channel'],
                    ['customer', 'customer'],
                    ['product', 'product'],
                ].map(([field, table]) => ({
                    name: `FK_customer_product_activity_${field}`,
                    columnNames: [`${field}Id`],
                    referencedTableName: table,
                    referencedColumnNames: ['id'],
                    onDelete: 'CASCADE',
                })),
            }),
            true,
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('customer_product_activity')) {
            await runner.dropTable('customer_product_activity', true);
        }
    }
}
