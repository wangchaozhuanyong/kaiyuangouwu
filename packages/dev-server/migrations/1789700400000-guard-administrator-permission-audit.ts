import { MigrationInterface, QueryRunner } from 'typeorm';

const tableName = 'administrator_permission_audit';
const updateTrigger = 'administrator_permission_audit_no_update';
const deleteTrigger = 'administrator_permission_audit_no_delete';
const postgresFunction = 'reject_administrator_permission_audit_change';
const message = 'Administrator permission audit is append-only';

export class GuardAdministratorPermissionAudit1789700400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable(tableName))) {
            throw new Error('Administrator permission audit table must exist before guard migration');
        }
        const type = queryRunner.connection.options.type;
        if (['sqlite', 'better-sqlite3', 'sqljs'].includes(type)) {
            await queryRunner.query(
                `CREATE TRIGGER IF NOT EXISTS "${updateTrigger}" BEFORE UPDATE ON "${tableName}"
                 BEGIN SELECT RAISE(ABORT, '${message}'); END`,
            );
            await queryRunner.query(
                `CREATE TRIGGER IF NOT EXISTS "${deleteTrigger}" BEFORE DELETE ON "${tableName}"
                 BEGIN SELECT RAISE(ABORT, '${message}'); END`,
            );
            return;
        }
        if (type === 'mysql' || type === 'mariadb') {
            for (const [name, operation] of [
                [updateTrigger, 'UPDATE'],
                [deleteTrigger, 'DELETE'],
            ] as const) {
                const existing = (await queryRunner.query(
                    `SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS
                     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ? LIMIT 1`,
                    [name],
                )) as Array<{ name: string }>;
                if (existing.length > 0) continue;
                await queryRunner.query(
                    `CREATE TRIGGER \`${name}\` BEFORE ${operation} ON \`${tableName}\`
                     FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`,
                );
            }
            return;
        }
        if (type === 'postgres') {
            await queryRunner.query(
                `CREATE OR REPLACE FUNCTION "${postgresFunction}"() RETURNS trigger AS $$
                 BEGIN RAISE EXCEPTION '${message}'; END; $$ LANGUAGE plpgsql`,
            );
            for (const [name, operation] of [
                [updateTrigger, 'UPDATE'],
                [deleteTrigger, 'DELETE'],
            ] as const) {
                const existing = (await queryRunner.query(
                    `SELECT 1 FROM pg_trigger WHERE tgname = $1
                     AND tgrelid = '"${tableName}"'::regclass LIMIT 1`,
                    [name],
                )) as unknown[];
                if (existing.length > 0) continue;
                await queryRunner.query(
                    `CREATE TRIGGER "${name}" BEFORE ${operation} ON "${tableName}"
                     FOR EACH ROW EXECUTE FUNCTION "${postgresFunction}"()`,
                );
            }
            return;
        }
        throw new Error(`Unsupported audit guard database type: ${type}`);
    }

    async down(): Promise<void> {
        // The audit record and its append-only guard survive code rollback.
    }
}
