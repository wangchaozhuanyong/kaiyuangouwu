import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

/** Additive only; existing mails, aliases and query codes are retained. */
export class AddIcloudMailEvents1791075600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const dateType =
            runner.connection.options.type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(runner.connection.options.type);
        const idType = runner.connection.options.type === 'postgres' || isSqlite ? 'integer' : 'int';
        for (const column of [
            { name: 'lastSyncedUidValidity', type: 'varchar', length: '32', isNullable: true },
            { name: 'mailWatchOwner', type: 'varchar', length: '36', isNullable: true },
            { name: 'mailWatchLeaseUntil', type: dateType, isNullable: true },
        ]) {
            if (!(await runner.hasColumn('icloud_primary_account', column.name)))
                await runner.addColumn('icloud_primary_account', new TableColumn(column));
        }
        if (!(await runner.hasTable('icloud_mail_outbox')))
            await runner.createTable(
                new Table({
                    name: 'icloud_mail_outbox',
                    columns: [
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                        { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                        { name: 'eventId', type: 'varchar', length: '36', isUnique: true },
                        { name: 'primaryAccountId', type: 'varchar', length: '64' },
                        { name: 'virtualEmailId', type: 'varchar', length: '64', isNullable: true },
                        { name: 'deliveredAt', type: dateType, isNullable: true },
                    ],
                    indices: [{ name: 'IDX_icloud_outbox_pending', columnNames: ['deliveredAt', 'id'] }],
                }),
            );
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain mailbox events and delivery receipts; use a forward migration.'),
        );
    }
}
