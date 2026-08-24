import { MigrationInterface, QueryRunner } from 'typeorm';

import { serviceCatalogProducts } from './1787612400000-complete-bilingual-service-catalog';

const variantModeColumn = 'customFieldsDigitaldeliverymode';
const orderLineModeColumn = 'customFieldsDigitaldeliverymodesnapshot';
const fulfillmentTypeColumn = 'customFieldsFulfillmenttype';

export class AddManualDigitalServiceMode1787616000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.changeDefault(queryRunner, 'product_variant', variantModeColumn, 'manual_service');
        await this.changeDefault(queryRunner, 'order_line', orderLineModeColumn, 'manual_service');
        await this.updateServiceCatalogModes(queryRunner, 'file_download', 'manual_service');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.updateServiceCatalogModes(queryRunner, 'manual_service', 'file_download');
        await this.changeDefault(queryRunner, 'order_line', orderLineModeColumn, 'file_download');
        await this.changeDefault(queryRunner, 'product_variant', variantModeColumn, 'file_download');
    }

    private async changeDefault(
        queryRunner: QueryRunner,
        tableName: 'product_variant' | 'order_line',
        columnName: string,
        mode: 'manual_service' | 'file_download',
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column) return;

        const updatedColumn = column.clone();
        updatedColumn.default = `'${mode}'`;
        await queryRunner.changeColumn(table, column, updatedColumn);
    }

    private async updateServiceCatalogModes(
        queryRunner: QueryRunner,
        from: 'manual_service' | 'file_download',
        to: 'manual_service' | 'file_download',
    ): Promise<void> {
        const table = await queryRunner.getTable('product_variant');
        if (!table?.findColumnByName(variantModeColumn) || !table.findColumnByName(fulfillmentTypeColumn)) {
            return;
        }

        const skus = serviceCatalogProducts.map(product => this.stringLiteral(product.sku)).join(', ');
        await queryRunner.query(
            `UPDATE ${this.quote('product_variant', queryRunner)} ` +
                `SET ${this.quote(variantModeColumn, queryRunner)} = '${to}' ` +
                `WHERE ${this.quote('sku', queryRunner)} IN (${skus}) ` +
                `AND ${this.quote(fulfillmentTypeColumn, queryRunner)} = 'digital' ` +
                `AND (${this.quote(variantModeColumn, queryRunner)} = '${from}' ` +
                `OR ${this.quote(variantModeColumn, queryRunner)} IS NULL)`,
        );
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }

    private stringLiteral(value: string): string {
        return `'${value.replace(/'/g, "''")}'`;
    }
}
