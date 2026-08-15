import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddStoreAdministratorAccess1786767600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('store_administrator_access')) {
            return;
        }

        const databaseType = queryRunner.connection.options.type;
        const isMysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const idType =
            databaseType === 'postgres' || databaseType === 'sqlite' || databaseType === 'better-sqlite3'
                ? 'integer'
                : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql
            ? 'CURRENT_TIMESTAMP(6)'
            : databaseType === 'sqlite' || databaseType === 'better-sqlite3'
              ? "datetime('now')"
              : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = isMysql ? 'tinyint' : 'boolean';
        const booleanTrue = databaseType === 'postgres' ? true : 1;
        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });

        await queryRunner.createTable(
            new Table({
                name: 'store_administrator_access',
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
                    { name: 'administratorId', type: idType },
                    { name: 'userId', type: idType },
                    { name: 'mustChangePassword', type: booleanType, default: booleanTrue },
                ],
                indices: [
                    {
                        name: 'IDX_store_administrator_access_administrator',
                        columnNames: ['administratorId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_store_administrator_access_user',
                        columnNames: ['userId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_store_administrator_access_administrator',
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
        await queryRunner.dropTable('store_administrator_access', true);
    }
}
