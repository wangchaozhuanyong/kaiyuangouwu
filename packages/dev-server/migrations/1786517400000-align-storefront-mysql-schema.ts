import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const timestampTables = [
    'storefront_cart',
    'storefront_cart_line',
    'storefront_cart_checkout',
    'storefront_cart_checkout_line',
    'store_domain',
];

export class AlignStorefrontMysqlSchema1786517400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) {
            return;
        }

        for (const table of timestampTables) {
            await queryRunner.changeColumn(
                table,
                'createdAt',
                new TableColumn({
                    name: 'createdAt',
                    type: 'datetime',
                    precision: 6,
                    default: 'CURRENT_TIMESTAMP(6)',
                }),
            );
            await queryRunner.changeColumn(
                table,
                'updatedAt',
                new TableColumn({
                    name: 'updatedAt',
                    type: 'datetime',
                    precision: 6,
                    default: 'CURRENT_TIMESTAMP(6)',
                    onUpdate: 'CURRENT_TIMESTAMP(6)',
                }),
            );
        }

        await this.changeBooleanColumn(queryRunner, 'storefront_cart', 'initialized', 0);
        await this.changeBooleanColumn(queryRunner, 'storefront_cart_line', 'selected', 1);
        await this.changeBooleanColumn(queryRunner, 'store_domain', 'isPrimary', 0);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) {
            return;
        }

        for (const table of timestampTables) {
            await queryRunner.changeColumn(
                table,
                'createdAt',
                new TableColumn({
                    name: 'createdAt',
                    type: 'datetime',
                    default: 'CURRENT_TIMESTAMP',
                }),
            );
            await queryRunner.changeColumn(
                table,
                'updatedAt',
                new TableColumn({
                    name: 'updatedAt',
                    type: 'datetime',
                    default: 'CURRENT_TIMESTAMP',
                }),
            );
        }

        await this.changeBooleanColumn(queryRunner, 'storefront_cart', 'initialized', 0, 'boolean');
        await this.changeBooleanColumn(queryRunner, 'storefront_cart_line', 'selected', 1, 'boolean');
        await this.changeBooleanColumn(queryRunner, 'store_domain', 'isPrimary', 0, 'boolean');
    }

    private async changeBooleanColumn(
        queryRunner: QueryRunner,
        table: string,
        column: string,
        defaultValue: 0 | 1,
        type = 'tinyint',
    ): Promise<void> {
        await queryRunner.changeColumn(
            table,
            column,
            new TableColumn({ name: column, type, default: defaultValue }),
        );
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
