import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const customerOrderNoteColumn = 'customFieldsCustomernote';

export class AddCustomerOrderNote1786764000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (!order?.findColumnByName(customerOrderNoteColumn)) {
            const databaseType = queryRunner.connection.options.type;
            const columnType = databaseType === 'mysql' || databaseType === 'mariadb' ? 'longtext' : 'text';
            await queryRunner.addColumn(
                'order',
                new TableColumn({
                    name: customerOrderNoteColumn,
                    type: columnType,
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
