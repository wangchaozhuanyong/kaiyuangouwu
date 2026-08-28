import { MigrationInterface, QueryRunner } from 'typeorm';

const fulfillmentTypeColumn = 'customFieldsFulfillmenttype';
const trackInventoryColumn = 'trackInventory';

export class NormalizeDigitalInventory1787796000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('product_variant');
        if (
            !table?.findColumnByName(fulfillmentTypeColumn) ||
            !table.findColumnByName(trackInventoryColumn)
        ) {
            return;
        }

        const productVariant = this.quote('product_variant', queryRunner);
        const fulfillmentType = this.quote(fulfillmentTypeColumn, queryRunner);
        const trackInventory = this.quote(trackInventoryColumn, queryRunner);
        await queryRunner.query(
            `UPDATE ${productVariant} ` +
                `SET ${trackInventory} = 'FALSE' ` +
                `WHERE ${fulfillmentType} = 'digital' ` +
                `AND (${trackInventory} IS NULL OR ${trackInventory} <> 'FALSE')`,
        );
    }

    public async down(): Promise<void> {
        // The previous per-variant value is unknown, so reverting it would risk enabling inventory incorrectly.
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }
}
