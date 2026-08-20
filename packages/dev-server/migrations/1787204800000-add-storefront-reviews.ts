import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddStorefrontReviews1787204800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_review')) {
            return;
        }
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

        await queryRunner.createTable(
            new Table({
                name: 'storefront_review',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    timestampColumn('createdAt'),
                    timestampColumn('updatedAt'),
                    { name: 'state', type: 'varchar', length: '16', default: "'PENDING'" },
                    { name: 'rating', type: 'int' },
                    { name: 'title', type: 'varchar', length: '120' },
                    { name: 'body', type: 'text' },
                    { name: 'customerName', type: 'varchar', length: '120' },
                    { name: 'productName', type: 'varchar', length: '255' },
                    { name: 'sku', type: 'varchar', length: '255' },
                    { name: 'merchantResponse', type: 'text', isNullable: true },
                    {
                        name: 'moderatedAt',
                        type: dateType,
                        ...(isMysql ? { precision: 6 } : {}),
                        isNullable: true,
                    },
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType, isNullable: true },
                    { name: 'orderId', type: idType, isNullable: true },
                    { name: 'orderLineId', type: idType, isNullable: true },
                    { name: 'productId', type: idType, isNullable: true },
                    { name: 'productVariantId', type: idType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_review_channel_state_created',
                        columnNames: ['channelId', 'state', 'createdAt'],
                    },
                    {
                        name: 'IDX_storefront_review_product_state_created',
                        columnNames: ['productId', 'state', 'createdAt'],
                    },
                    {
                        name: 'IDX_storefront_review_customer_created',
                        columnNames: ['customerId', 'createdAt'],
                    },
                    {
                        name: 'IDX_storefront_review_order_line',
                        columnNames: ['orderLineId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_storefront_review_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_storefront_review_customer',
                        columnNames: ['customerId'],
                        referencedTableName: 'customer',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_storefront_review_order',
                        columnNames: ['orderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_storefront_review_order_line',
                        columnNames: ['orderLineId'],
                        referencedTableName: 'order_line',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_storefront_review_product',
                        columnNames: ['productId'],
                        referencedTableName: 'product',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_storefront_review_product_variant',
                        columnNames: ['productVariantId'],
                        referencedTableName: 'product_variant',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_review')) {
            await queryRunner.dropTable('storefront_review', true);
        }
    }
}
