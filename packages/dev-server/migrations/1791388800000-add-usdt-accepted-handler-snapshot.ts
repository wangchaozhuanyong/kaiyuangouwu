import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const tableName = 'storefront_usdt_payment_intent';
const columnName = 'acceptedHandlerSnapshot';

export class AddUsdtAcceptedHandlerSnapshot1791388800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(tableName))) throw new Error('USDT payment intent table must exist');
        if (await queryRunner.hasColumn(tableName, columnName)) return;
        await queryRunner.addColumn(
            tableName,
            new TableColumn({ name: columnName, type: 'text', isNullable: true }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(tableName)) || !(await queryRunner.hasColumn(tableName, columnName)))
            return;
        const escape = queryRunner.connection.driver.escape.bind(queryRunner.connection.driver);
        const accepted = await queryRunner.manager
            .createQueryBuilder()
            .select('intent.id', 'id')
            .from(tableName, 'intent')
            .where(`${escape('intent')}.${escape(columnName)} IS NOT NULL`)
            .limit(1)
            .getRawMany();
        if (accepted.length)
            throw new Error('Retain USDT acceptance evidence; use a schema-compatible rollback');
        await queryRunner.dropColumn(tableName, columnName);
    }
}
