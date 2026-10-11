import { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve cost history while allowing an explicit "unset" cost interval. */
export class AllowUnsetCatalogCost1791676800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('catalog_variant_cost_record');
        const column = table?.findColumnByName('costMicrounits');
        if (!table || !column) {
            throw new Error('Catalog cost schema must exist before allowing unset costs');
        }
        if (column.isNullable) return;
        const nullableColumn = column.clone();
        nullableColumn.isNullable = true;
        await queryRunner.changeColumn(table, column, nullableColumn);
    }

    async down(): Promise<void> {
        // Clear markers are audit history. Reverting nullability would destroy that history.
    }
}
