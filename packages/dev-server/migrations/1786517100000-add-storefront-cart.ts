import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddStorefrontCart1786517100000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType = databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now =
            databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? "datetime('now')"
                : 'CURRENT_TIMESTAMP';
        const booleanTrue = databaseType === 'postgres' ? true : 1;

        await queryRunner.createTable(
            new Table({
                name: 'storefront_cart',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: dateType, default: now },
                    { name: 'updatedAt', type: dateType, default: now },
                    { name: 'channelId', type: idType },
                    { name: 'ownerType', type: 'varchar', length: '16' },
                    { name: 'ownerId', type: idType },
                    { name: 'revision', type: 'int', default: 0 },
                    { name: 'state', type: 'varchar', length: '24', default: "'OPEN'" },
                    { name: 'checkoutOrderId', type: idType, isNullable: true },
                    { name: 'projectedRevision', type: 'int', isNullable: true },
                    { name: 'initialized', type: 'boolean', default: databaseType === 'postgres' ? false : 0 },
                    { name: 'lastActivityAt', type: dateType },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_cart_owner',
                        columnNames: ['channelId', 'ownerType', 'ownerId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_storefront_cart_active_order',
                        columnNames: ['checkoutOrderId'],
                        isUnique: true,
                    },
                    { name: 'IDX_storefront_cart_activity', columnNames: ['lastActivityAt'] },
                ],
                foreignKeys: [
                    {
                        name: 'FK_1fc82434cf72cc2f2331dc7ae92',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_dd8fecf032261059620774538b4',
                        columnNames: ['checkoutOrderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                ],
            }),
            true,
        );

        await queryRunner.createTable(
            new Table({
                name: 'storefront_cart_line',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: dateType, default: now },
                    { name: 'updatedAt', type: dateType, default: now },
                    { name: 'cartId', type: idType },
                    { name: 'productVariantId', type: idType },
                    { name: 'quantity', type: 'int' },
                    { name: 'selected', type: 'boolean', default: booleanTrue },
                    { name: 'orderLineId', type: idType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_cart_line_variant',
                        columnNames: ['cartId', 'productVariantId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_storefront_cart_line_order_line',
                        columnNames: ['orderLineId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_a7dfef03af017cd8d3303d139ac',
                        columnNames: ['cartId'],
                        referencedTableName: 'storefront_cart',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_fc4ebb77880b9f16355ba97e94f',
                        columnNames: ['productVariantId'],
                        referencedTableName: 'product_variant',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_4b16092e25690ed973fca613970',
                        columnNames: ['orderLineId'],
                        referencedTableName: 'order_line',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                ],
            }),
            true,
        );

        await queryRunner.createTable(
            new Table({
                name: 'storefront_cart_checkout',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: dateType, default: now },
                    { name: 'updatedAt', type: dateType, default: now },
                    { name: 'cartId', type: idType },
                    { name: 'orderId', type: idType },
                    { name: 'cartRevision', type: 'int' },
                    { name: 'state', type: 'varchar', length: '20', default: "'PREPARED'" },
                    { name: 'completedAt', type: dateType, isNullable: true },
                ],
                indices: [
                    { name: 'IDX_storefront_cart_checkout_cart', columnNames: ['cartId'] },
                    {
                        name: 'IDX_storefront_cart_checkout_order',
                        columnNames: ['orderId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_999b72b6d264f393ce623c1fa16',
                        columnNames: ['cartId'],
                        referencedTableName: 'storefront_cart',
                        referencedColumnNames: ['id'],
                    },
                    {
                        name: 'FK_62eae4cd2000102e470884e62c4',
                        columnNames: ['orderId'],
                        referencedTableName: 'order',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );

        await queryRunner.createTable(
            new Table({
                name: 'storefront_cart_checkout_line',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: dateType, default: now },
                    { name: 'updatedAt', type: dateType, default: now },
                    { name: 'checkoutId', type: idType },
                    { name: 'cartLineId', type: idType, isNullable: true },
                    { name: 'productVariantId', type: idType },
                    { name: 'quantity', type: 'int' },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_checkout_line_variant',
                        columnNames: ['checkoutId', 'productVariantId'],
                        isUnique: true,
                    },
                    { name: 'IDX_storefront_checkout_line_cart_line', columnNames: ['cartLineId'] },
                ],
                foreignKeys: [
                    {
                        name: 'FK_eb781b4c2e8d587fb9d4c250e8b',
                        columnNames: ['checkoutId'],
                        referencedTableName: 'storefront_cart_checkout',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                    {
                        name: 'FK_06fd288a0681d32056b3982af96',
                        columnNames: ['cartLineId'],
                        referencedTableName: 'storefront_cart_line',
                        referencedColumnNames: ['id'],
                        onDelete: 'SET NULL',
                    },
                    {
                        name: 'FK_50b17e57a4ee983399032f33b82',
                        columnNames: ['productVariantId'],
                        referencedTableName: 'product_variant',
                        referencedColumnNames: ['id'],
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('storefront_cart_checkout_line', true);
        await queryRunner.dropTable('storefront_cart_checkout', true);
        await queryRunner.dropTable('storefront_cart_line', true);
        await queryRunner.dropTable('storefront_cart', true);
    }
}
