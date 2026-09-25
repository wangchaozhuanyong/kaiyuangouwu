import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReviewAnonymous1790208060000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('storefront_review');
        if (!table) throw new Error('Storefront review table must exist before adding anonymous display');
        if (!table.findColumnByName('anonymous')) {
            await runner.addColumn(
                'storefront_review',
                new TableColumn({
                    name: 'anonymous',
                    type: 'boolean',
                    isNullable: false,
                    default: false,
                }),
            );
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('storefront_review');
        if (table?.findColumnByName('anonymous')) {
            await runner.dropColumn('storefront_review', 'anonymous');
        }
    }
}
