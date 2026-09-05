import { MigrationInterface, QueryRunner } from 'typeorm';

const securityTables = [
    'admin_two_factor_credential',
    'admin_two_factor_challenge',
    'admin_two_factor_session',
    'admin_two_factor_rate_limit',
];

export class AlignAdminTwoFactorTimestamps1788613200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await alignUpdatedAt(queryRunner, 'CURRENT_TIMESTAMP(6)');
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await alignUpdatedAt(queryRunner, undefined);
    }
}

async function alignUpdatedAt(queryRunner: QueryRunner, onUpdate: string | undefined): Promise<void> {
    if (!['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) return;

    for (const name of securityTables) {
        const table = await queryRunner.getTable(name);
        const column = table?.findColumnByName('updatedAt');
        if (!table || !column) throw new Error(`${name}.updatedAt must exist before timestamp alignment`);
        if (column.onUpdate?.toUpperCase() === onUpdate) continue;
        // Preserve existing data and column attributes while matching VendureEntity's UpdateDateColumn.
        const aligned = column.clone();
        aligned.onUpdate = onUpdate;
        await queryRunner.changeColumn(table, column, aligned);
    }
}
