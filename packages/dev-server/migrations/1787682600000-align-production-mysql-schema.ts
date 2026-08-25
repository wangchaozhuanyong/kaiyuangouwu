import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AlignProductionMysqlSchema1787682600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        const translationState = await queryRunner.getTable('content_translation_state');
        if (translationState) {
            for (const name of ['createdAt', 'updatedAt'] as const) {
                if (!translationState.findColumnByName(name)) continue;
                await queryRunner.changeColumn(
                    translationState,
                    name,
                    new TableColumn({
                        name,
                        type: 'datetime',
                        precision: 6,
                        isNullable: false,
                        default: 'CURRENT_TIMESTAMP(6)',
                        ...(name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                    }),
                );
            }
        }

        await this.alignColumn(queryRunner, 'customer_coupon', 'discountRate', column => {
            column.type = 'float';
            column.isNullable = true;
            column.default = undefined;
        });
        await this.alignColumn(queryRunner, 'customer_coupon', 'version', column => {
            column.type = 'int';
            column.isNullable = false;
            column.default = undefined;
        });
    }

    public async down(): Promise<void> {
        // This migration only aligns MySQL metadata with entity definitions and preserves data.
    }

    private async alignColumn(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        align: (column: TableColumn) => void,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column) return;
        const aligned = column.clone();
        align(aligned);
        await queryRunner.changeColumn(table, column, aligned);
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
