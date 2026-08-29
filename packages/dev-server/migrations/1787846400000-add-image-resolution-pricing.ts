import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddImageResolutionPricing1787846400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await addColumnIfMissing(
            queryRunner,
            'image_model_config',
            new TableColumn({ name: 'unitPrice2K', type: 'int', default: 0 }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_model_config',
            new TableColumn({ name: 'unitPrice4K', type: 'int', default: 0 }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_generation_job',
            new TableColumn({ name: 'resolution', type: 'varchar', length: '2', default: "'1K'" }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const [table, column] of [
            ['image_generation_job', 'resolution'],
            ['image_model_config', 'unitPrice4K'],
            ['image_model_config', 'unitPrice2K'],
        ] as const) {
            if ((await queryRunner.hasTable(table)) && (await queryRunner.hasColumn(table, column))) {
                await queryRunner.dropColumn(table, column);
            }
        }
    }
}

async function addColumnIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: TableColumn,
): Promise<void> {
    if ((await queryRunner.hasTable(table)) && !(await queryRunner.hasColumn(table, column.name))) {
        await queryRunner.addColumn(table, column);
    }
}
