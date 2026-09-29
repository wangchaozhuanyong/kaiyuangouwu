import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const columnName = 'customFieldsPricingmode';

export class AddProductPricingMode1790643600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const product = await queryRunner.getTable('product');
        if (product && !product.findColumnByName(columnName)) {
            await queryRunner.addColumn(
                product,
                new TableColumn({
                    name: columnName,
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const product = await queryRunner.getTable('product');
        if (product?.findColumnByName(columnName)) await queryRunner.dropColumn(product, columnName);
    }
}
