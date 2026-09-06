import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

/** Additive migration: rolling back application code must not discard queued work or translations. */
export class AddTranslationOutbox1788739200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const driver = queryRunner.connection.options.type;
        const date = driver === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const columns = [
            { name: 'revision', type: 'int', default: 1 },
            { name: 'attempts', type: 'int', default: 0 },
            { name: 'nextAttemptAt', type: date, isNullable: true },
            { name: 'leaseUntil', type: date, isNullable: true },
            { name: 'leaseToken', type: 'varchar', length: '36', isNullable: true },
            { name: 'lastErrorCode', type: 'varchar', length: '32', isNullable: true },
        ];
        for (const column of columns) {
            if (!(await queryRunner.hasColumn('content_translation_state', column.name))) {
                await queryRunner.addColumn('content_translation_state', new TableColumn(column));
            }
        }
        const table = await queryRunner.getTable('content_translation_state');
        if (!table?.indices.some(index => index.name === 'IDX_content_translation_state_due')) {
            await queryRunner.createIndex(
                'content_translation_state',
                new TableIndex({
                    name: 'IDX_content_translation_state_due',
                    columnNames: ['status', 'nextAttemptAt'],
                }),
            );
        }
        if (!(await queryRunner.hasTable('content_translation_provider_state'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'content_translation_provider_state',
                    columns: [
                        { name: 'provider', type: 'varchar', length: '128', isPrimary: true },
                        ...columns.filter(column => column.name !== 'revision'),
                        { name: 'blocked', type: 'boolean', default: false },
                        { name: 'scanOffset', type: 'int', default: 0 },
                        { name: 'notificationVersion', type: 'int', default: 0 },
                        { name: 'scanChannelIndex', type: 'int', default: 0 },
                        { name: 'scanComplete', type: 'boolean', default: false },
                    ],
                }),
            );
        }
        // The earlier retry implementation used TRANSLATING for a durable result awaiting notification.
        await queryRunner.manager
            .createQueryBuilder()
            .update('content_translation_state')
            .set({ status: 'NOTIFY_PENDING' })
            .where(
                `${queryRunner.connection.driver.escape('status')} = :status AND ${queryRunner.connection.driver.escape('leaseToken')} IS NULL`,
                { status: 'TRANSLATING' },
            )
            .execute();
    }

    async down(): Promise<void> {
        // Preserve Chinese content, reviewed English, queue state and operational evidence.
    }
}
