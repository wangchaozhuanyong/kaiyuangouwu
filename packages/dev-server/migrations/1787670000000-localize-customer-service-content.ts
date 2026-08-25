import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class LocalizeCustomerServiceContent1787670000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.addLocalizedColumns(queryRunner, 'storefront_review', [
            'merchantResponseZh',
            'merchantResponseEn',
        ]);
        await this.addLocalizedColumns(queryRunner, 'after_sales_request', ['resolutionZh', 'resolutionEn']);
        await this.copyLegacySource(
            queryRunner,
            'storefront_review',
            'merchantResponse',
            'merchantResponseZh',
        );
        await this.copyLegacySource(queryRunner, 'after_sales_request', 'resolution', 'resolutionZh');
    }

    public async down(): Promise<void> {
        // Localized customer-service content is intentionally retained to avoid deleting merchant data.
    }

    private async addLocalizedColumns(
        queryRunner: QueryRunner,
        tableName: string,
        columns: string[],
    ): Promise<void> {
        let table = await queryRunner.getTable(tableName);
        if (!table) return;
        for (const name of columns) {
            if (!table.findColumnByName(name)) {
                await queryRunner.addColumn(table, new TableColumn({ name, type: 'text', isNullable: true }));
                table = (await queryRunner.getTable(tableName)) ?? table;
            }
        }
    }

    private async copyLegacySource(
        queryRunner: QueryRunner,
        tableName: string,
        legacyColumn: string,
        sourceColumn: string,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table?.findColumnByName(legacyColumn) || !table.findColumnByName(sourceColumn)) return;
        await queryRunner.query(
            `UPDATE ${this.quote(tableName, queryRunner)} ` +
                `SET ${this.quote(sourceColumn, queryRunner)} = ${this.quote(legacyColumn, queryRunner)} ` +
                `WHERE ${this.quote(sourceColumn, queryRunner)} IS NULL ` +
                `AND ${this.quote(legacyColumn, queryRunner)} IS NOT NULL`,
        );
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }
}
