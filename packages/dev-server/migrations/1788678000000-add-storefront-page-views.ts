import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddStorefrontPageViews1788678000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('storefront_page_view')) return;
        const type = queryRunner.connection.options.type;
        const mysql = ['mysql', 'mariadb'].includes(type);
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        const integer = type === 'postgres' || sqlite ? 'integer' : 'int';
        const date = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        await queryRunner.createTable(
            new Table({
                name: 'storefront_page_view',
                columns: [
                    {
                        name: 'id',
                        type: integer,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    ...['createdAt', 'updatedAt'].map(name => ({
                        name,
                        type: date,
                        default: now,
                        ...(mysql ? { precision: 6 } : {}),
                    })),
                    { name: 'channelId', type: integer },
                    { name: 'businessDate', type: 'varchar', length: '10' },
                    { name: 'eventId', type: 'varchar', length: '36' },
                    { name: 'visitorKeyHash', type: 'varchar', length: '64' },
                    { name: 'customerKeyHash', type: 'varchar', length: '64', isNullable: true },
                    { name: 'ipHash', type: 'varchar', length: '64', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_storefront_page_view_event',
                        columnNames: ['channelId', 'eventId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_storefront_page_view_day',
                        columnNames: ['channelId', 'businessDate', 'visitorKeyHash'],
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_storefront_page_view_channel',
                        columnNames: ['channelId'],
                        referencedTableName: 'channel',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    async down(): Promise<void> {
        // Code rollback must not erase collected traffic. Table removal needs separate approval.
    }
}
