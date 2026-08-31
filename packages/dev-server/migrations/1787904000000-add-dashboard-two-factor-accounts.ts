import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddDashboardTwoFactorAccounts1787904000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('dashboard_two_factor_account')) return;

        const databaseType = queryRunner.connection.options.type;
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';

        await queryRunner.createTable(
            new Table({
                name: 'dashboard_two_factor_account',
                columns: [
                    {
                        name: 'createdAt',
                        type: dateType,
                        ...(isMysql ? { precision: 6 } : {}),
                        default: now,
                    },
                    {
                        name: 'updatedAt',
                        type: dateType,
                        ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                        default: now,
                    },
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'projectName', type: 'varchar', length: '80' },
                    { name: 'encryptedSecret', type: 'text' },
                    { name: 'fingerprint', type: 'varchar', length: '64' },
                    { name: 'lastUsedAt', type: dateType, isNullable: true },
                    { name: 'administratorId', type: idType },
                ],
                indices: [
                    {
                        name: 'IDX_dashboard_two_factor_owner_created',
                        columnNames: ['administratorId', 'createdAt'],
                    },
                    {
                        name: 'IDX_dashboard_two_factor_owner_fingerprint',
                        columnNames: ['administratorId', 'fingerprint'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_dashboard_two_factor_administrator',
                        columnNames: ['administratorId'],
                        referencedTableName: 'administrator',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('dashboard_two_factor_account')) {
            await queryRunner.dropTable('dashboard_two_factor_account', true);
        }
    }
}
