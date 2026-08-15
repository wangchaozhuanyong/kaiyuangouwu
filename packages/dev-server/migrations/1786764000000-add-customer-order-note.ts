import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const customerOrderNoteColumn = 'customFieldsCustomernote';

export class AddCustomerOrderNote1786764000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (!order?.findColumnByName(customerOrderNoteColumn)) {
            await queryRunner.addColumn(
                'order',
                new TableColumn({
                    name: customerOrderNoteColumn,
                    type: 'text',
                    isNullable: true,
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (order?.findColumnByName(customerOrderNoteColumn)) {
            await queryRunner.dropColumn('order', customerOrderNoteColumn);
        }
    }
}
