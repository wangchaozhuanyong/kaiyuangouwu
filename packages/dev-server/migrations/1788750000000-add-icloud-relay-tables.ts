import { MigrationInterface, QueryRunner, Table, TableColumn, TableColumnOptions } from 'typeorm';

export class AddIcloudRelayTables1788750000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType = isMysql ? 'tinyint' : isSqlite ? 'integer' : 'boolean';
        const booleanFalse = isMysql || isSqlite ? 0 : false;

        const timestampColumn = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(isMysql ? { precision: 6 } : {}),
            default: now,
            ...(isMysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });

        // 1. icloud_primary_account
        if (!(await queryRunner.hasTable('icloud_primary_account'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'icloud_primary_account',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'email', type: 'varchar', length: '255', isUnique: true },
                        { name: 'encryptedAppPassword', type: 'text' },
                        { name: 'imapHost', type: 'varchar', length: '255', default: "'imap.mail.me.com'" },
                        { name: 'imapPort', type: 'int', default: 993 },
                        { name: 'note', type: 'text', isNullable: true },
                        { name: 'status', type: 'varchar', length: '32', default: "'ACTIVE'" },
                        {
                            name: 'masterQueryCode',
                            type: 'varchar',
                            length: '64',
                            isUnique: true,
                            isNullable: true,
                        },
                        { name: 'codeExpiresAt', type: dateType, isNullable: true },
                        { name: 'codeResetIntervalDays', type: 'int', default: 30 },
                        { name: 'lastQueriedAt', type: dateType, isNullable: true },
                        { name: 'lastQueriedIp', type: 'varchar', length: '64', isNullable: true },
                        { name: 'lastSyncedAt', type: dateType, isNullable: true },
                        { name: 'lastSyncedUid', type: 'int', default: 0 },
                        { name: 'lastSyncError', type: 'text', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_icloud_master_query_code',
                            columnNames: ['masterQueryCode'],
                        },
                    ],
                }),
                true,
            );
        }

        // 2. icloud_virtual_email
        if (!(await queryRunner.hasTable('icloud_virtual_email'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'icloud_virtual_email',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'primaryAccountId', type: idType },
                        { name: 'aliasEmail', type: 'varchar', length: '255', isUnique: true },
                        { name: 'note', type: 'text', isNullable: true },
                        { name: 'status', type: 'varchar', length: '32', default: "'ACTIVE'" },
                        { name: 'buyerQueryCode', type: 'varchar', length: '64', isUnique: true },
                        { name: 'codeExpiresAt', type: dateType, isNullable: true },
                        { name: 'codeResetIntervalDays', type: 'int', default: 30 },
                        { name: 'lastQueriedAt', type: dateType, isNullable: true },
                        { name: 'lastQueriedIp', type: 'varchar', length: '64', isNullable: true },
                        { name: 'mailCount', type: 'int', default: 0 },
                        { name: 'lastMailReceivedAt', type: dateType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_icloud_virtual_email_alias',
                            columnNames: ['aliasEmail'],
                        },
                        {
                            name: 'IDX_icloud_buyer_query_code',
                            columnNames: ['buyerQueryCode'],
                        },
                        {
                            name: 'IDX_icloud_virtual_account_alias',
                            columnNames: ['primaryAccountId', 'aliasEmail'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_icloud_virtual_primary_account',
                            columnNames: ['primaryAccountId'],
                            referencedTableName: 'icloud_primary_account',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        } else {
            // Table was created in partial previous run - ensure missing columns are added safely
            if (typeof queryRunner.hasColumn === 'function') {
                if (!(await queryRunner.hasColumn('icloud_virtual_email', 'mailCount'))) {
                    await queryRunner.addColumn(
                        'icloud_virtual_email',
                        new TableColumn({
                            name: 'mailCount',
                            type: 'int',
                            default: 0,
                        }),
                    );
                }
                if (!(await queryRunner.hasColumn('icloud_virtual_email', 'lastMailReceivedAt'))) {
                    await queryRunner.addColumn(
                        'icloud_virtual_email',
                        new TableColumn({
                            name: 'lastMailReceivedAt',
                            type: dateType,
                            isNullable: true,
                        }),
                    );
                }
            }
        }

        // 3. icloud_received_mail
        if (!(await queryRunner.hasTable('icloud_received_mail'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'icloud_received_mail',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'primaryAccountId', type: idType },
                        { name: 'virtualEmailId', type: idType, isNullable: true },
                        { name: 'messageId', type: 'varchar', length: '255' },
                        { name: 'imapUid', type: 'int', default: 0 },
                        { name: 'fromAddress', type: 'varchar', length: '255' },
                        { name: 'fromName', type: 'varchar', length: '255', default: "''" },
                        { name: 'toAddressesJson', type: 'text', isNullable: true },
                        { name: 'subject', type: 'varchar', length: '500', default: "'(No Subject)'" },
                        { name: 'bodyHtml', type: 'text', isNullable: true },
                        { name: 'bodyText', type: 'text', isNullable: true },
                        { name: 'extractedCode', type: 'varchar', length: '64', isNullable: true },
                        { name: 'receivedAt', type: dateType },
                        { name: 'isRead', type: booleanType, default: booleanFalse },
                        { name: 'isStarred', type: booleanType, default: booleanFalse },
                    ],
                    indices: [
                        {
                            name: 'IDX_icloud_mail_account_msgid',
                            columnNames: ['primaryAccountId', 'messageId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_icloud_mail_virtual_received',
                            columnNames: ['virtualEmailId', 'receivedAt'],
                        },
                        {
                            name: 'IDX_icloud_mail_extracted_code',
                            columnNames: ['extractedCode'],
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_icloud_mail_primary_account',
                            columnNames: ['primaryAccountId'],
                            referencedTableName: 'icloud_primary_account',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_icloud_mail_virtual_email',
                            columnNames: ['virtualEmailId'],
                            referencedTableName: 'icloud_virtual_email',
                            referencedColumnNames: ['id'],
                            onDelete: 'SET NULL',
                        },
                    ],
                }),
                true,
            );
        }

        // 4. icloud_query_audit_log
        if (!(await queryRunner.hasTable('icloud_query_audit_log'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'icloud_query_audit_log',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        timestampColumn('createdAt'),
                        timestampColumn('updatedAt'),
                        { name: 'queryCode', type: 'varchar', length: '64' },
                        { name: 'targetType', type: 'varchar', length: '32', isNullable: true },
                        { name: 'targetId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'ipAddress', type: 'varchar', length: '64' },
                        { name: 'userAgent', type: 'text', isNullable: true },
                        { name: 'result', type: 'varchar', length: '32', default: "'SUCCESS'" },
                        { name: 'queriedAt', type: dateType },
                    ],
                    indices: [
                        {
                            name: 'IDX_icloud_audit_code_time',
                            columnNames: ['queryCode', 'queriedAt'],
                        },
                        {
                            name: 'IDX_icloud_audit_ip_time',
                            columnNames: ['ipAddress', 'queriedAt'],
                        },
                    ],
                }),
                true,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of [
            'icloud_query_audit_log',
            'icloud_received_mail',
            'icloud_virtual_email',
            'icloud_primary_account',
        ]) {
            if (await queryRunner.hasTable(table)) {
                await queryRunner.dropTable(table, true);
            }
        }
    }
}
