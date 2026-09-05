import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions, TableIndex } from 'typeorm';

const tableName = 'store_coupon_campaign_config';
const indexName = 'IDX_store_coupon_campaign_config_channel_archived_created';

export class AddCouponCampaignArchive1788652860000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(tableName))) return;
        const table = await queryRunner.getTable(tableName);
        if (!table?.findColumnByName('archivedAt')) {
            const dateType: TableColumnOptions['type'] =
                queryRunner.connection.options.type === 'postgres'
                    ? 'timestamp without time zone'
                    : 'datetime';
            await queryRunner.addColumn(
                tableName,
                new TableColumn({ name: 'archivedAt', type: dateType, isNullable: true }),
            );
        }
        const updatedTable = await queryRunner.getTable(tableName);
        if (updatedTable && !updatedTable.indices.some(index => index.name === indexName)) {
            await queryRunner.createIndex(
                tableName,
                new TableIndex({
                    name: indexName,
                    columnNames: ['channelId', 'archivedAt', 'createdAt'],
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(tableName))) return;
        const table = await queryRunner.getTable(tableName);
        if (table?.indices.some(index => index.name === indexName)) {
            await queryRunner.dropIndex(tableName, indexName);
        }
        const updatedTable = await queryRunner.getTable(tableName);
        if (updatedTable?.findColumnByName('archivedAt')) {
            await queryRunner.dropColumn(tableName, 'archivedAt');
        }
    }
}
