import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class NormalizeStorefrontExchangeRate1787770800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        const current = channel?.findColumnByName('customFieldsCnytomyrrate');
        if (!channel || !current || (current.isNullable && current.default == null)) return;
        const databaseType = queryRunner.connection.options.type;
        const type =
            databaseType === 'mysql' || databaseType === 'mariadb'
                ? 'double'
                : databaseType === 'postgres' || databaseType === 'cockroachdb'
                  ? 'double precision'
                  : 'float';
        await queryRunner.changeColumn(
            channel,
            current,
            new TableColumn({
                name: current.name,
                type,
                isNullable: true,
            }),
        );
    }

    public async down(): Promise<void> {
        // Removing a database default is data-preserving and intentionally not reverted.
    }
}
