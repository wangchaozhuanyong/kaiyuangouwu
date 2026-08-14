import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const storefrontNameColumns = [
    { name: 'customFieldsStorefrontnamezh', defaultValue: '云桥Ai' },
    { name: 'customFieldsStorefrontnameen', defaultValue: 'Yunqiao Ai' },
] as const;

export class AddStorefrontNames1786517700000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        for (const column of storefrontNameColumns) {
            if (!channel?.findColumnByName(column.name)) {
                await queryRunner.addColumn(
                    'channel',
                    new TableColumn({
                        name: column.name,
                        type: 'varchar',
                        length: '32',
                        isNullable: false,
                        default: `'${column.defaultValue}'`,
                    }),
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const channel = await queryRunner.getTable('channel');
        for (const column of [...storefrontNameColumns].reverse()) {
            if (channel?.findColumnByName(column.name)) {
                await queryRunner.dropColumn('channel', column.name);
            }
        }
    }
}
