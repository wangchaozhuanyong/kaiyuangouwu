import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReviewImages1790310120000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('storefront_review');
        if (!table) throw new Error('Storefront review table must exist before adding images');
        if (!table.findColumnByName('imageAssets')) {
            await runner.addColumn(
                'storefront_review',
                new TableColumn({ name: 'imageAssets', type: 'text', isNullable: true }),
            );
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('storefront_review');
        if (table?.findColumnByName('imageAssets')) {
            await runner.dropColumn('storefront_review', 'imageAssets');
        }
    }
}
