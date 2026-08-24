import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const defaultLanguageCode = 'zh_Hans';

export class AlignAutoCardDeliverySchema1787598000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.alignLanguageCode(queryRunner);
        await this.makeTextColumnRequired(queryRunner, 'auto_card_config', 'instructions');
        await this.makeTextColumnRequired(queryRunner, 'auto_card_delivery', 'instructionsSnapshot');
    }

    public async down(): Promise<void> {
        // This migration repairs databases created from an earlier entity snapshot.
        // Reverting it would make the schema incompatible with the preceding creation migration.
    }

    private async alignLanguageCode(queryRunner: QueryRunner): Promise<void> {
        let table = await queryRunner.getTable('auto_card_delivery');
        if (!table) return;

        let column = table.findColumnByName('languageCode');
        if (!column) {
            await queryRunner.addColumn(
                table,
                new TableColumn({
                    name: 'languageCode',
                    type: 'varchar',
                    length: '16',
                    isNullable: true,
                }),
            );
            table = await queryRunner.getTable('auto_card_delivery');
            column = table?.findColumnByName('languageCode');
        }
        if (!table || !column || !column.isNullable) return;

        await queryRunner.query(
            `UPDATE ${this.quote('auto_card_delivery', queryRunner)} ` +
                `SET ${this.quote('languageCode', queryRunner)} = '${defaultLanguageCode}' ` +
                `WHERE ${this.quote('languageCode', queryRunner)} IS NULL`,
        );
        const updatedColumn = column.clone();
        updatedColumn.isNullable = false;
        updatedColumn.default = undefined;
        await queryRunner.changeColumn(table, column, updatedColumn);
    }

    private async makeTextColumnRequired(
        queryRunner: QueryRunner,
        tableName: 'auto_card_config' | 'auto_card_delivery',
        columnName: 'instructions' | 'instructionsSnapshot',
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (
            !table ||
            !column ||
            (!column.isNullable && column.type === 'text' && column.default === undefined)
        ) {
            return;
        }

        await queryRunner.query(
            `UPDATE ${this.quote(tableName, queryRunner)} ` +
                `SET ${this.quote(columnName, queryRunner)} = '' ` +
                `WHERE ${this.quote(columnName, queryRunner)} IS NULL`,
        );
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `ALTER TABLE ${this.quote(tableName, queryRunner)} ` +
                    `MODIFY ${this.quote(columnName, queryRunner)} text NOT NULL`,
            );
            return;
        }
        const updatedColumn = column.clone();
        updatedColumn.type = 'text';
        updatedColumn.isNullable = false;
        updatedColumn.default = undefined;
        await queryRunner.changeColumn(table, column, updatedColumn);
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }
}
