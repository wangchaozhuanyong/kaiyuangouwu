import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddStoreDomains1786515900000 implements MigrationInterface {
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
        const booleanFalse = databaseType === 'postgres' ? false : 0;

        await queryRunner.createTable(
            new Table({
                name: 'store_domain',
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
                    { name: 'domain', type: 'varchar', length: '253' },
                    { name: 'channelId', type: idType },
                    { name: 'isPrimary', type: 'boolean', default: booleanFalse },
                    { name: 'primaryChannelId', type: idType, isNullable: true },
                    { name: 'status', type: 'varchar', length: '20', default: "'PENDING'" },
                    { name: 'verificationToken', type: 'varchar', length: '64' },
                    { name: 'verifiedAt', type: dateType, isNullable: true },
                    { name: 'lastVerificationError', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_36a88cefcc22fac0222079c389',
                        columnNames: ['domain'],
                        isUnique: true,
                    },
                    { name: 'IDX_383d2c7041771dd66c76253f02', columnNames: ['channelId'] },
                    {
                        name: 'IDX_d8ca74d5c641c93dc7126c1698',
                        columnNames: ['primaryChannelId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_8b3e90561eb467996d03ea4342',
                        columnNames: ['verificationToken'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        name: 'FK_383d2c7041771dd66c76253f025',
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

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('store_domain', true);
    }
}
