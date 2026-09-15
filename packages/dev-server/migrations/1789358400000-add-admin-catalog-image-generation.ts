/* eslint-disable @typescript-eslint/require-await -- MigrationInterface requires Promise-returning hooks. */
import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AddAdminCatalogImageGeneration1789358400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const idType = ['mysql', 'mariadb'].includes(String(databaseType)) ? 'int' : 'integer';

        await this.makeCustomerNullable(
            queryRunner,
            'image_generation_job',
            'FK_image_generation_job_customer',
        );
        await this.addColumn(
            queryRunner,
            'image_generation_job',
            new TableColumn({
                name: 'origin',
                type: 'varchar',
                length: '32',
                default: "'CUSTOMER_STUDIO'",
            }),
        );
        await this.addColumn(
            queryRunner,
            'image_generation_job',
            new TableColumn({
                name: 'administratorUserId',
                type: idType,
                isNullable: true,
            }),
        );
        await this.addForeignKey(
            queryRunner,
            'image_generation_job',
            new TableForeignKey({
                name: 'FK_image_generation_job_admin',
                columnNames: ['administratorUserId'],
                referencedTableName: 'user',
                referencedColumnNames: ['id'],
                onDelete: 'SET NULL',
            }),
        );
        await this.addIndex(
            queryRunner,
            'image_generation_job',
            new TableIndex({
                name: 'IDX_image_generation_job_admin_idempotency',
                columnNames: ['channelId', 'administratorUserId', 'idempotencyKey'],
                isUnique: true,
            }),
        );
        await this.addIndex(
            queryRunner,
            'image_generation_job',
            new TableIndex({
                name: 'IDX_image_generation_job_admin_created',
                columnNames: ['administratorUserId', 'createdAt'],
            }),
        );

        await this.makeCustomerNullable(
            queryRunner,
            'image_private_asset',
            'FK_image_private_asset_customer',
        );
        await this.addColumn(
            queryRunner,
            'image_private_asset',
            new TableColumn({
                name: 'administratorUserId',
                type: idType,
                isNullable: true,
            }),
        );
        await this.addForeignKey(
            queryRunner,
            'image_private_asset',
            new TableForeignKey({
                name: 'FK_image_private_asset_admin',
                columnNames: ['administratorUserId'],
                referencedTableName: 'user',
                referencedColumnNames: ['id'],
                onDelete: 'SET NULL',
            }),
        );
        await this.addIndex(
            queryRunner,
            'image_private_asset',
            new TableIndex({
                name: 'IDX_image_private_asset_admin_created',
                columnNames: ['administratorUserId', 'createdAt'],
            }),
        );

        await this.addColumn(
            queryRunner,
            'image_generation_output',
            new TableColumn({
                name: 'catalogAssetId',
                type: idType,
                isNullable: true,
            }),
        );
        await this.addColumn(
            queryRunner,
            'image_generation_output',
            new TableColumn({
                name: 'usedAt',
                type: 'datetime',
                isNullable: true,
            }),
        );
        await this.addForeignKey(
            queryRunner,
            'image_generation_output',
            new TableForeignKey({
                name: 'FK_image_generation_output_catalog_asset',
                columnNames: ['catalogAssetId'],
                referencedTableName: 'asset',
                referencedColumnNames: ['id'],
                onDelete: 'SET NULL',
            }),
        );
    }

    async down(): Promise<void> {
        throw new Error('ADMIN_PRODUCT_IMAGE 任务可能已生成长期素材，该迁移不支持自动回滚');
    }

    private async makeCustomerNullable(
        queryRunner: QueryRunner,
        tableName: string,
        foreignKeyName: string,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName('customerId');
        if (!table || !column || column.isNullable) return;
        const foreignKey = table.foreignKeys.find(item => item.name === foreignKeyName);
        if (foreignKey) await queryRunner.dropForeignKey(table, foreignKey);
        const replacement = column.clone();
        replacement.isNullable = true;
        await queryRunner.changeColumn(table, column, replacement);
        if (foreignKey) {
            await queryRunner.createForeignKey(
                tableName,
                new TableForeignKey({
                    name: foreignKeyName,
                    columnNames: foreignKey.columnNames,
                    referencedTableName: foreignKey.referencedTableName,
                    referencedColumnNames: foreignKey.referencedColumnNames,
                    onDelete: 'CASCADE',
                    onUpdate: foreignKey.onUpdate,
                    deferrable: foreignKey.deferrable,
                }),
            );
        }
    }

    private async addColumn(queryRunner: QueryRunner, table: string, column: TableColumn) {
        if (!(await queryRunner.hasColumn(table, column.name))) await queryRunner.addColumn(table, column);
    }

    private async addIndex(queryRunner: QueryRunner, tableName: string, index: TableIndex) {
        const table = await queryRunner.getTable(tableName);
        if (!table?.indices.some(item => item.name === index.name)) {
            await queryRunner.createIndex(tableName, index);
        }
    }

    private async addForeignKey(queryRunner: QueryRunner, tableName: string, foreignKey: TableForeignKey) {
        const table = await queryRunner.getTable(tableName);
        if (!table?.foreignKeys.some(item => item.name === foreignKey.name)) {
            await queryRunner.createForeignKey(tableName, foreignKey);
        }
    }
}
