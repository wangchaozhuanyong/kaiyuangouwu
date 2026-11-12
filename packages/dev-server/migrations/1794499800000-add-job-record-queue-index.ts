import { type MigrationInterface, type QueryRunner, type Table, TableIndex } from 'typeorm';

const tableName = 'job_record';
const indexName = 'IDX_job_record_queue_state_created';
const columnNames = ['queueName', 'state', 'createdAt'];

export class AddJobRecordQueueIndex1794499800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const { table, index } = await this.inspect(queryRunner);
        if (!index) await this.changeIndex(queryRunner, table, 'add');
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const { table, index } = await this.inspect(queryRunner);
        if (index) await this.changeIndex(queryRunner, table, 'drop');
    }

    private async inspect(queryRunner: QueryRunner) {
        const table = await queryRunner.getTable(tableName);
        if (!table) throw new Error('Job queue table is missing');
        const index = table.indices.find(candidate => candidate.name === indexName);
        if (index && (index.isUnique || index.columnNames.join(',') !== columnNames.join(','))) {
            throw new Error('Existing job queue index does not match the migration');
        }
        return { table, index };
    }

    private async changeIndex(queryRunner: QueryRunner, table: Table, action: 'add' | 'drop'): Promise<void> {
        const { type } = queryRunner.connection.options;
        if (type !== 'mysql' && type !== 'mariadb') {
            if (action === 'add') {
                await queryRunner.createIndex(table, new TableIndex({ name: indexName, columnNames }));
            } else {
                await queryRunner.dropIndex(table, indexName);
            }
            return;
        }

        const [{ lockWaitTimeout }] = (await queryRunner.query(
            'SELECT @@SESSION.lock_wait_timeout AS lockWaitTimeout',
        )) as Array<{ lockWaitTimeout: number | string }>;
        const originalTimeout = Number(lockWaitTimeout);
        await queryRunner.query('SET SESSION lock_wait_timeout = ?', [Math.min(originalTimeout, 5)]);
        try {
            const operation =
                action === 'add'
                    ? `ADD INDEX \`${indexName}\` (\`queueName\`, \`state\`, \`createdAt\`)`
                    : `DROP INDEX \`${indexName}\``;
            // Require concurrent reads and writes and bound metadata lock waits on production MySQL.
            await queryRunner.query(
                `ALTER TABLE \`${tableName}\` ${operation}, ALGORITHM=INPLACE, LOCK=NONE`,
            );
        } finally {
            await queryRunner.query('SET SESSION lock_wait_timeout = ?', [originalTimeout]);
        }
    }
}
