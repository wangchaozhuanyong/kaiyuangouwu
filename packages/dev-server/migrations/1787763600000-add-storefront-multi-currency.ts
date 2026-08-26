import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

const columns: TableColumnOptions[] = [
    {
        name: 'customFieldsCurrencyselectorenabled',
        type: 'boolean',
        isNullable: false,
        default: true,
    },
    {
        name: 'customFieldsCurrencyratemode',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'AUTO'",
    },
    {
        name: 'customFieldsCnytomyrrate',
        type: 'float',
        isNullable: true,
    },
    {
        name: 'customFieldsCurrencyratemarkupbps',
        type: 'int',
        isNullable: false,
        default: 0,
    },
    {
        name: 'customFieldsCurrencyroundingmode',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'CENT'",
    },
    {
        name: 'customFieldsCurrencyratesource',
        type: 'varchar',
        length: '120',
        isNullable: true,
    },
    {
        name: 'customFieldsCurrencyrateupdatedat',
        type: 'datetime',
        isNullable: true,
    },
    {
        name: 'customFieldsCurrencypricesupdatedat',
        type: 'datetime',
        isNullable: true,
    },
    {
        name: 'customFieldsCurrencysyncedpricecount',
        type: 'int',
        isNullable: false,
        default: 0,
    },
];

export class AddStorefrontMultiCurrency1787763600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        if (!channel) return;
        const databaseType = queryRunner.connection.options.type;
        for (const definition of columns) {
            if (channel.findColumnByName(definition.name)) continue;
            const normalized = { ...definition };
            if (definition.name === 'customFieldsCurrencyselectorenabled') {
                normalized.type =
                    databaseType === 'mysql' || databaseType === 'mariadb' ? 'tinyint' : 'boolean';
                normalized.default = databaseType === 'postgres' ? true : 1;
            }
            if (
                definition.type === 'datetime' &&
                (databaseType === 'postgres' || databaseType === 'cockroachdb')
            ) {
                normalized.type = 'timestamp';
            }
            if (definition.type === 'datetime' && (databaseType === 'mysql' || databaseType === 'mariadb')) {
                normalized.precision = 6;
            }
            if (definition.name === 'customFieldsCnytomyrrate') {
                if (databaseType === 'mysql' || databaseType === 'mariadb') normalized.type = 'double';
                if (databaseType === 'postgres' || databaseType === 'cockroachdb') {
                    normalized.type = 'double precision';
                }
            }
            await queryRunner.addColumn('channel', new TableColumn(normalized));
        }

        await queryRunner.manager
            .createQueryBuilder()
            .update('channel')
            .set({ availableCurrencyCodes: 'CNY,MYR' })
            .where('code = :code', { code: 'cn-mainland' })
            .execute();
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        if (!channel) return;
        for (const definition of [...columns].reverse()) {
            if (channel.findColumnByName(definition.name)) {
                await queryRunner.dropColumn('channel', definition.name);
            }
        }
    }
}
