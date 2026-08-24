import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAutoCardBilingualInstructions1787608800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        let table = await queryRunner.getTable('auto_card_config');
        if (!table) return;

        for (const name of ['instructionsZh', 'instructionsEn'] as const) {
            if (!table.findColumnByName(name)) {
                await queryRunner.addColumn(table, new TableColumn({ name, type: 'text', isNullable: true }));
                table = (await queryRunner.getTable('auto_card_config')) ?? table;
            }
        }

        await queryRunner.query(
            `UPDATE ${this.quote('auto_card_config', queryRunner)} ` +
                `SET ${this.quote('instructionsZh', queryRunner)} = ${this.quote('instructions', queryRunner)} ` +
                `WHERE ${this.quote('instructionsZh', queryRunner)} IS NULL`,
        );
        await queryRunner.query(
            `UPDATE ${this.quote('auto_card_config', queryRunner)} ` +
                `SET ${this.quote('instructionsEn', queryRunner)} = '' ` +
                `WHERE ${this.quote('instructionsEn', queryRunner)} IS NULL`,
        );
    }

    public async down(): Promise<void> {
        // Bilingual instructions are intentionally preserved to avoid deleting merchant content.
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }
}
