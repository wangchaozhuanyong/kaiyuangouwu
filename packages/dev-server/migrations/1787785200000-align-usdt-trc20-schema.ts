import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignUsdtTrc20Schema1787785200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) return;

        const table = await queryRunner.getTable('storefront_usdt_checkout_quote');
        const rate = table?.findColumnByName('fiatPerUsdtRate');
        if (!table || !rate || rate.type === 'float') return;

        const aligned = rate.clone();
        aligned.type = 'float';
        aligned.precision = undefined;
        aligned.scale = undefined;
        await queryRunner.changeColumn(table, rate, aligned);
    }

    public async down(): Promise<void> {
        // This data-preserving migration aligns MySQL metadata with the entity definition.
    }
}
