import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const paymentCurrencyColumn = 'customFieldsPaymentcurrencycode';

export class AddOrderPaymentCurrency1789405200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (!order?.findColumnByName(paymentCurrencyColumn)) {
            await queryRunner.addColumn(
                'order',
                new TableColumn({
                    name: paymentCurrencyColumn,
                    type: 'varchar',
                    length: '8',
                    isNullable: true,
                }),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const order = await queryRunner.getTable('order');
        if (order?.findColumnByName(paymentCurrencyColumn)) {
            await queryRunner.dropColumn('order', paymentCurrencyColumn);
        }
    }
}
