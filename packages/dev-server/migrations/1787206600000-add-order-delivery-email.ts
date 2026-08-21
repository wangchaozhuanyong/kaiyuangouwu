import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const deliveryEmailColumn = 'customFieldsDeliveryemail';

export class AddOrderDeliveryEmail1787206600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (!order?.findColumnByName(deliveryEmailColumn)) {
            await queryRunner.addColumn(
                'order',
                new TableColumn({
                    name: deliveryEmailColumn,
                    type: 'varchar',
                    length: '254',
                    isNullable: true,
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (order?.findColumnByName(deliveryEmailColumn)) {
            await queryRunner.dropColumn('order', deliveryEmailColumn);
        }
    }
}
