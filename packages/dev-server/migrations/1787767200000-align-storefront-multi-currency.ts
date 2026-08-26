import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AlignStorefrontMultiCurrency1787767200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) return;
        const channel = await queryRunner.getTable('channel');
        if (!channel) return;

        const rate = channel.findColumnByName('customFieldsCnytomyrrate');
        if (rate && rate.type !== 'double') {
            await queryRunner.changeColumn(
                channel,
                rate,
                new TableColumn({
                    name: rate.name,
                    type: 'double',
                    isNullable: true,
                }),
            );
        }

        for (const name of ['customFieldsCurrencyrateupdatedat', 'customFieldsCurrencypricesupdatedat']) {
            const current = channel.findColumnByName(name);
            if (!current || (current.type === 'datetime' && current.precision === 6)) continue;
            await queryRunner.changeColumn(
                channel,
                current,
                new TableColumn({
                    name,
                    type: 'datetime',
                    precision: 6,
                    isNullable: true,
                }),
            );
        }
    }

    public async down(): Promise<void> {
        // Precision alignment is data-preserving and intentionally not reverted.
    }
}
