import { referralPosterCopy } from '@vendure/store-management-plugin';
import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE_NAME = 'referral_poster_template';

/** Align future inserts with the shared preset. Existing poster records are never updated. */
export class NeutralReferralPosterDefaults1790640000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const table = await queryRunner.getTable(TABLE_NAME);
        if (!table) throw new Error(`${TABLE_NAME} is missing; poster defaults were not changed`);
        const copyColumns = Object.entries(referralPosterCopy).map(([name, value]) => {
            const column = table.findColumnByName(name);
            if (!column)
                throw new Error(`${TABLE_NAME}.${name} is missing; poster defaults were not changed`);
            return { name, value, column };
        });

        for (const { name, value, column } of copyColumns) {
            const quoted = `'${value.replace(/'/g, "''")}'`;
            const existing = String(column.default ?? '')
                .replace(/^['"]|['"]$/g, '')
                .replace(/''/g, "'");
            if (existing === value) continue;

            if (databaseType === 'mysql' || databaseType === 'mariadb') {
                await queryRunner.query(
                    `ALTER TABLE \`${TABLE_NAME}\` ALTER COLUMN \`${name}\` SET DEFAULT ${quoted}`,
                );
            } else if (databaseType === 'postgres') {
                await queryRunner.query(
                    `ALTER TABLE "${TABLE_NAME}" ALTER COLUMN "${name}" SET DEFAULT ${quoted}`,
                );
            } else {
                // SQLite cannot alter a column default in place; TypeORM preserves the existing rows.
                const aligned = column.clone();
                aligned.default = quoted;
                await queryRunner.changeColumn(table, column, aligned);
            }
        }
    }

    public async down(): Promise<void> {
        // Reinstating merchant-specific defaults would reintroduce the defect.
    }
}
