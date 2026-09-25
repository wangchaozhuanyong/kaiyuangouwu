import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCouponAppearanceTheme1790208000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('store_coupon_campaign_config');
        if (!table) throw new Error('Store coupon campaign config must exist before adding appearance theme');
        if (!table.findColumnByName('appearanceTheme')) {
            await runner.addColumn(
                'store_coupon_campaign_config',
                new TableColumn({
                    name: 'appearanceTheme',
                    type: 'varchar',
                    length: '16',
                    isNullable: true,
                }),
            );
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('store_coupon_campaign_config');
        if (table?.findColumnByName('appearanceTheme')) {
            await runner.dropColumn('store_coupon_campaign_config', 'appearanceTheme');
        }
    }
}
