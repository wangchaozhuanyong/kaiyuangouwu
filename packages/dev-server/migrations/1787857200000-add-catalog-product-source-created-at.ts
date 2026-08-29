import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const columnName = 'customFieldsSourcecreatedat';

export class AddCatalogProductSourceCreatedAt1787857200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const product = await queryRunner.getTable('product');
        if (!product || product.findColumnByName(columnName)) return;
        await queryRunner.addColumn(
            product,
            new TableColumn({
                name: columnName,
                type: datetimeType(queryRunner),
                ...(isMysql(queryRunner) ? { precision: 6 } : {}),
                isNullable: true,
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const product = await queryRunner.getTable('product');
        if (product?.findColumnByName(columnName)) {
            await queryRunner.dropColumn(product, columnName);
        }
    }
}

function datetimeType(queryRunner: QueryRunner): string {
    return queryRunner.connection.options.type === 'postgres' ? 'timestamp without time zone' : 'datetime';
}

function isMysql(queryRunner: QueryRunner): boolean {
    return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
}
