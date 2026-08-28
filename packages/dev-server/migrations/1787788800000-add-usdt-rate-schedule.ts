import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

const columns: TableColumnOptions[] = [
    {
        name: 'customFieldsUsdtrateschedulemode',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'INTERVAL'",
    },
    {
        name: 'customFieldsUsdtrateintervalminutes',
        type: 'int',
        isNullable: false,
        default: 5,
    },
    {
        name: 'customFieldsUsdtratedailytime',
        type: 'varchar',
        length: '5',
        isNullable: false,
        default: "'10:00'",
    },
];

export class AddUsdtRateSchedule1787788800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        if (!channel) return;
        for (const definition of columns) {
            if (channel.findColumnByName(definition.name)) continue;
            await queryRunner.addColumn('channel', new TableColumn(definition));
        }
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
