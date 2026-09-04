import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

export class AddStoreDomainAutomation1788526800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('store_domain'))) return;
        const databaseType = queryRunner.connection.options.type;
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const booleanType: TableColumnOptions['type'] =
            databaseType === 'mysql' || databaseType === 'mariadb' ? 'tinyint' : 'boolean';
        const booleanFalse = databaseType === 'postgres' ? false : 0;
        const columns: TableColumnOptions[] = [
            { name: 'provisioningMode', type: 'varchar', length: '24', default: "'MANUAL'" },
            { name: 'dnsManaged', type: booleanType, default: booleanFalse },
            { name: 'providerExternalId', type: 'varchar', length: '64', isNullable: true },
            { name: 'providerHostnameStatus', type: 'varchar', length: '40', isNullable: true },
            { name: 'providerSslStatus', type: 'varchar', length: '40', isNullable: true },
            { name: 'lastProvisionedAt', type: dateType, isNullable: true },
        ];
        for (const column of columns) {
            const table = await queryRunner.getTable('store_domain');
            if (table && !table.findColumnByName(column.name)) {
                await queryRunner.addColumn('store_domain', new TableColumn(column));
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('store_domain'))) return;
        for (const name of [
            'lastProvisionedAt',
            'providerSslStatus',
            'providerHostnameStatus',
            'providerExternalId',
            'dnsManaged',
            'provisioningMode',
        ]) {
            const table = await queryRunner.getTable('store_domain');
            if (table?.findColumnByName(name)) {
                await queryRunner.dropColumn('store_domain', name);
            }
        }
    }
}
