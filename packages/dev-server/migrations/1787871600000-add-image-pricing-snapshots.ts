import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddImagePricingSnapshots1787871600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await addColumnIfMissing(
            queryRunner,
            'image_generation_job',
            new TableColumn({ name: 'pricingSnapshot', type: 'text', isNullable: true }),
        );
        await addColumnIfMissing(
            queryRunner,
            'image_prompt_optimization',
            new TableColumn({ name: 'pricingSnapshot', type: 'text', isNullable: true }),
        );
        await backfillLegacySnapshots(queryRunner, 'image_generation_job', 'unitPriceSnapshot');
        await backfillLegacySnapshots(queryRunner, 'image_prompt_optimization', 'chargedAmount');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['image_prompt_optimization', 'image_generation_job']) {
            if (
                (await queryRunner.hasTable(table)) &&
                (await queryRunner.hasColumn(table, 'pricingSnapshot'))
            ) {
                await queryRunner.dropColumn(table, 'pricingSnapshot');
            }
        }
    }
}

async function addColumnIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: TableColumn,
): Promise<void> {
    if ((await queryRunner.hasTable(table)) && !(await queryRunner.hasColumn(table, column.name))) {
        await queryRunner.addColumn(table, column);
    }
}

async function backfillLegacySnapshots(
    queryRunner: QueryRunner,
    table: string,
    amountColumn: string,
): Promise<void> {
    if (
        !(await queryRunner.hasTable(table)) ||
        !(await queryRunner.hasColumn(table, amountColumn)) ||
        !(await queryRunner.hasColumn(table, 'currencyCode')) ||
        !(await queryRunner.hasColumn(table, 'pricingSnapshot'))
    ) {
        return;
    }
    const escape = (value: string) => queryRunner.connection.driver.escape(value);
    const idColumn = escape('id');
    const currencyColumn = escape('currencyCode');
    const snapshotColumn = escape('pricingSnapshot');
    const rows = (await queryRunner.query(
        `SELECT ${idColumn} AS id, ${escape(amountColumn)} AS amount, ` +
            `${currencyColumn} AS currencyCode FROM ${escape(table)} WHERE ${snapshotColumn} IS NULL`,
    )) as Array<{ id: string | number; amount: string | number | null; currencyCode: string }>;
    for (const row of rows) {
        const amount = Number(row.amount ?? 0);
        const pricingSnapshot = JSON.stringify({
            baseAmount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
            baseCurrencyCode: row.currencyCode,
            settlementAmount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
            settlementCurrencyCode: row.currencyCode,
            cnyToMyrRate: null,
            markupPercent: 0,
            roundingMode: 'CENT',
            rateUpdatedAt: null,
        });
        await queryRunner.manager
            .createQueryBuilder()
            .update(table)
            .set({ pricingSnapshot })
            .where(`${escape('id')} = :id`, { id: row.id })
            .execute();
    }
}
