import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddAdminLoginTwoFactor1788609600000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const type = queryRunner.connection.options.type;
        const mysql = ['mysql', 'mariadb'].includes(type);
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        const integer = type === 'postgres' || sqlite ? 'integer' : 'int';
        const date = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const dates: TableColumnOptions[] = ['createdAt', 'updatedAt'].map(name => ({
            name,
            type: date,
            default: now,
            ...(mysql ? { precision: 6 } : {}),
        }));
        const base: TableColumnOptions[] = [
            {
                name: 'id',
                type: integer,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            },
            ...dates,
        ];
        const user = { name: 'userId', type: integer };
        const version = { name: 'authVersion', type: 'varchar', length: '64' };
        const fingerprint = { name: 'passwordFingerprint', type: 'varchar', length: '64' };
        const userFk = {
            columnNames: ['userId'],
            referencedTableName: 'user',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
        };
        const tables = [
            new Table({
                name: 'admin_two_factor_credential',
                columns: [
                    ...base,
                    user,
                    version,
                    { name: 'enabledAt', type: date, isNullable: true },
                    { name: 'encryptedSecret', type: 'text', isNullable: true },
                    { name: 'pendingSecret', type: 'text', isNullable: true },
                    { name: 'pendingExpiresAt', type: date, isNullable: true },
                    { name: 'recoveryHashes', type: 'text' },
                    { name: 'lastUsedStep', type: integer, default: -1 },
                    { name: 'revision', type: integer, default: 0 },
                ],
                indices: [{ name: 'IDX_admin_2fa_credential_user', columnNames: ['userId'], isUnique: true }],
                foreignKeys: [userFk],
            }),
            new Table({
                name: 'admin_two_factor_challenge',
                columns: [
                    ...base,
                    user,
                    version,
                    fingerprint,
                    { name: 'tokenHash', type: 'varchar', length: '64' },
                    { name: 'expiresAt', type: date },
                    { name: 'consumedAt', type: date, isNullable: true },
                    { name: 'attempts', type: integer, default: 0 },
                    {
                        name: 'rememberMe',
                        type: type === 'postgres' ? 'boolean' : 'tinyint',
                        default: type === 'postgres' ? 'false' : 0,
                    },
                ],
                indices: [
                    { name: 'IDX_admin_2fa_challenge_token', columnNames: ['tokenHash'], isUnique: true },
                    { name: 'IDX_admin_2fa_challenge_expires', columnNames: ['expiresAt'] },
                ],
                foreignKeys: [userFk],
            }),
            new Table({
                name: 'admin_two_factor_session',
                columns: [...base, user, version, fingerprint, { name: 'sessionId', type: integer }],
                indices: [{ name: 'IDX_admin_2fa_session_id', columnNames: ['sessionId'], isUnique: true }],
                foreignKeys: [
                    {
                        columnNames: ['sessionId'],
                        referencedTableName: 'session',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            new Table({
                name: 'admin_two_factor_rate_limit',
                columns: [
                    ...base,
                    { name: 'bucket', type: 'varchar', length: '64' },
                    { name: 'expiresAt', type: date },
                    { name: 'attempts', type: integer, default: 0 },
                ],
                indices: [
                    { name: 'IDX_admin_2fa_rate_bucket', columnNames: ['bucket'], isUnique: true },
                    { name: 'IDX_admin_2fa_rate_expires', columnNames: ['expiresAt'] },
                ],
            }),
        ];
        for (const table of tables) {
            if (!(await queryRunner.hasTable(table.name))) await queryRunner.createTable(table, true);
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        for (const name of [
            'admin_two_factor_session',
            'admin_two_factor_challenge',
            'admin_two_factor_rate_limit',
            'admin_two_factor_credential',
        ]) {
            if (await queryRunner.hasTable(name)) await queryRunner.dropTable(name, true);
        }
    }
}
