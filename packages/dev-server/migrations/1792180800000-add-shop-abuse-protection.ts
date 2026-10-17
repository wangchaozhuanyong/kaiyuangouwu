import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

/** Store only irreversible abuse-control identities and short-lived challenge state. */
export class AddShopAbuseProtection1792180800000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const driver = runner.connection.options.type;
        const mysql = driver === 'mysql' || driver === 'mariadb';
        const sqlite = ['sqljs', 'sqlite', 'better-sqlite3'].includes(driver);
        const integerType = mysql ? 'int' : 'integer';
        const dateType = driver === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const date = (name: string, nullable = false): TableColumnOptions => ({
            name,
            type: dateType,
            isNullable: nullable,
            ...(mysql ? { precision: 6 } : {}),
        });
        const base = (): TableColumnOptions[] => [
            {
                name: 'id',
                type: integerType,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            },
            { ...date('createdAt'), default: now },
            { ...date('updatedAt'), default: now, ...(mysql ? { onUpdate: now } : {}) },
        ];
        const digest = (name: string): TableColumnOptions => ({ name, type: 'varchar', length: '64' });
        const tables = [
            new Table({
                name: 'shop_abuse_bucket',
                columns: [
                    ...base(),
                    digest('bucket'),
                    { name: 'attempts', type: integerType, default: 0 },
                    date('expiresAt'),
                    date('blockedUntil', true),
                ],
                indices: [
                    { name: 'UQ_shop_abuse_bucket_bucket', columnNames: ['bucket'], isUnique: true },
                    { name: 'IDX_shop_abuse_bucket_expires', columnNames: ['expiresAt'] },
                ],
            }),
            new Table({
                name: 'shop_abuse_challenge',
                columns: [
                    ...base(),
                    digest('publicId'),
                    digest('bindingHash'),
                    digest('answerDigest'),
                    date('expiresAt'),
                    date('consumedAt', true),
                ],
                indices: [
                    { name: 'UQ_shop_abuse_challenge_public', columnNames: ['publicId'], isUnique: true },
                    { name: 'IDX_shop_abuse_challenge_expires', columnNames: ['expiresAt'] },
                ],
            }),
        ];
        for (const table of tables) {
            if (!(await runner.hasTable(table.name))) await runner.createTable(table, true);
        }
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Shop abuse protection contains security state; destructive rollback requires a separate reviewed migration.',
            ),
        );
    }
}
