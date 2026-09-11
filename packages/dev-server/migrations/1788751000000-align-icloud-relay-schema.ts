import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

export class AlignIcloudRelaySchema1788751000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const booleanType = isMysql ? 'tinyint' : isSqlite ? 'integer' : 'boolean';
        const booleanFalse = isMysql || isSqlite ? 0 : false;

        // 1. icloud_virtual_email columns
        if (await queryRunner.hasTable('icloud_virtual_email')) {
            if (!(await queryRunner.hasColumn('icloud_virtual_email', 'mailCount'))) {
                await queryRunner.addColumn(
                    'icloud_virtual_email',
                    new TableColumn({
                        name: 'mailCount',
                        type: 'int',
                        default: 0,
                    }),
                );
            }
            if (!(await queryRunner.hasColumn('icloud_virtual_email', 'lastMailReceivedAt'))) {
                await queryRunner.addColumn(
                    'icloud_virtual_email',
                    new TableColumn({
                        name: 'lastMailReceivedAt',
                        type: dateType,
                        isNullable: true,
                    }),
                );
            }
        }

        // 2. icloud_received_mail columns
        if (await queryRunner.hasTable('icloud_received_mail')) {
            if (!(await queryRunner.hasColumn('icloud_received_mail', 'isStarred'))) {
                await queryRunner.addColumn(
                    'icloud_received_mail',
                    new TableColumn({
                        name: 'isStarred',
                        type: booleanType,
                        default: booleanFalse,
                    }),
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('icloud_virtual_email')) {
            if (await queryRunner.hasColumn('icloud_virtual_email', 'lastMailReceivedAt')) {
                await queryRunner.dropColumn('icloud_virtual_email', 'lastMailReceivedAt');
            }
            if (await queryRunner.hasColumn('icloud_virtual_email', 'mailCount')) {
                await queryRunner.dropColumn('icloud_virtual_email', 'mailCount');
            }
        }
        if (await queryRunner.hasTable('icloud_received_mail')) {
            if (await queryRunner.hasColumn('icloud_received_mail', 'isStarred')) {
                await queryRunner.dropColumn('icloud_received_mail', 'isStarred');
            }
        }
    }
}
