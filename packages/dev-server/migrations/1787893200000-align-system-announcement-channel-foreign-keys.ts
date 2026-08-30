import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

const tableName = 'system_announcement_channels_channel';
const foreignKeys = [
    {
        name: 'FK_system_announcement_channels_announcement',
        columnNames: ['systemAnnouncementId'],
        referencedTableName: 'system_announcement',
        referencedColumnNames: ['id'],
    },
    {
        name: 'FK_system_announcement_channels_channel',
        columnNames: ['channelId'],
        referencedTableName: 'channel',
        referencedColumnNames: ['id'],
    },
] as const;

export class AlignSystemAnnouncementChannelForeignKeys1787893200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await alignForeignKeys(queryRunner, 'CASCADE');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await alignForeignKeys(queryRunner, 'NO ACTION');
    }
}

async function alignForeignKeys(queryRunner: QueryRunner, onUpdate: 'CASCADE' | 'NO ACTION') {
    for (const expected of foreignKeys) {
        const table = await queryRunner.getTable(tableName);
        if (!table) {
            throw new Error(`${tableName} must exist before aligning announcement Channel foreign keys`);
        }
        const current = table.foreignKeys.find(foreignKey => foreignKey.name === expected.name);
        if (current?.onDelete === 'CASCADE' && current.onUpdate === onUpdate) continue;

        if (current) await queryRunner.dropForeignKey(tableName, current);
        await queryRunner.createForeignKey(
            tableName,
            new TableForeignKey({
                ...expected,
                onDelete: 'CASCADE',
                onUpdate,
            }),
        );
    }
}
