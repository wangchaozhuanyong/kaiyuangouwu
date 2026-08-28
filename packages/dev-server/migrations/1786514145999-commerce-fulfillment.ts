import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const orderLineColumn = 'customFieldsFulfillmenttypesnapshot';
const productVariantColumn = 'customFieldsFulfillmenttype';

export class CommerceFulfillment1786514145999 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const orderLine = await queryRunner.getTable('order_line');
        if (orderLine && !orderLine.findColumnByName(orderLineColumn)) {
            await queryRunner.addColumn(
                'order_line',
                new TableColumn({
                    name: orderLineColumn,
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                    default: "'physical'",
                }),
            );
        }

        const productVariant = await queryRunner.getTable('product_variant');
        if (productVariant && !productVariant.findColumnByName(productVariantColumn)) {
            await queryRunner.addColumn(
                'product_variant',
                new TableColumn({
                    name: productVariantColumn,
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                    default: "'physical'",
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const productVariant = await queryRunner.getTable('product_variant');
        if (productVariant?.findColumnByName(productVariantColumn)) {
            await queryRunner.dropColumn('product_variant', productVariantColumn);
        }

        const orderLine = await queryRunner.getTable('order_line');
        if (orderLine?.findColumnByName(orderLineColumn)) {
            await queryRunner.dropColumn('order_line', orderLineColumn);
        }
    }
}
