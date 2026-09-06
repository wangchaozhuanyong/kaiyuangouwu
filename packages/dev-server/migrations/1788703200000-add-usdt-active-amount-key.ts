import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

const tableName = 'storefront_usdt_payment_intent';
const activeIndex = 'IDX_storefront_usdt_intent_active_match_key';

export class AddUsdtActiveAmountKey1788703200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table) throw new Error('USDT payment intents must exist before adding active amount keys');
        if (!table.findColumnByName('activeMatchKey')) {
            await queryRunner.addColumn(
                tableName,
                new TableColumn({
                    name: 'activeMatchKey',
                    type: 'varchar',
                    length: '64',
                    isNullable: true,
                }),
            );
        }
        if (
            table.indices.some(
                index => index.name === 'IDX_storefront_usdt_intent_match_key' && index.isUnique,
            )
        ) {
            // Keep all old reservations until the new scanner reconciles their complete windows.
            const escape = queryRunner.connection.driver.escape.bind(queryRunner.connection.driver);
            await queryRunner.query(
                `UPDATE ${escape(tableName)} SET ${escape('activeMatchKey')} = ${escape('matchKey')}, ` +
                    `${escape('updatedAt')} = ${escape('updatedAt')} WHERE ${escape('activeMatchKey')} IS NULL`,
            );
        }
        if (!(await queryRunner.getTable(tableName))?.indices.some(index => index.name === activeIndex)) {
            await queryRunner.createIndex(
                tableName,
                new TableIndex({
                    name: activeIndex,
                    columnNames: ['activeMatchKey'],
                    isUnique: true,
                }),
            );
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table?.findColumnByName('activeMatchKey')) return;
        if (
            !table.indices.some(
                index => index.name === 'IDX_storefront_usdt_intent_match_key' && index.isUnique,
            )
        ) {
            throw new Error('Restore the historical unique index before removing active amount keys');
        }
        await queryRunner.dropColumn(tableName, 'activeMatchKey');
    }
}
