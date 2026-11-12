import 'reflect-metadata';

import { DataSource, type QueryRunner, Table } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddJobRecordQueueIndex1794499800000 } from './1794499800000-add-job-record-queue-index';

const indexName = 'IDX_job_record_queue_state_created';

describe('AddJobRecordQueueIndex1794499800000', () => {
    let dataSource: DataSource | undefined;

    afterEach(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('indexes existing jobs and preserves selection order on apply, retry and revert', async () => {
        dataSource = await new DataSource({ type: 'sqljs' }).initialize();
        const runner = dataSource.createQueryRunner();
        try {
            await runner.query(
                'CREATE TABLE job_record (id integer PRIMARY KEY, queueName varchar NOT NULL, state varchar NOT NULL, createdAt integer NOT NULL)',
            );
            await runner.query(
                "INSERT INTO job_record VALUES (1, 'target', 'COMPLETED', 1), (2, 'target', 'PENDING', 4), (3, 'target', 'RETRYING', 2), (4, 'other', 'PENDING', 0)",
            );
            const readyJobs =
                "SELECT id FROM job_record WHERE queueName = 'target' AND (state = 'PENDING' OR state = 'RETRYING')";
            const migration = new AddJobRecordQueueIndex1794499800000();
            await migration.up(runner);
            await migration.up(runner);

            expect((await runner.getTable('job_record'))?.indices).toMatchObject([
                { name: indexName, columnNames: ['queueName', 'state', 'createdAt'], isUnique: false },
            ]);
            expect(await runner.query(`EXPLAIN QUERY PLAN ${readyJobs} LIMIT 1`)).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ detail: expect.stringContaining(indexName) }),
                ]),
            );
            expect(await runner.query(`${readyJobs} ORDER BY createdAt LIMIT 1`)).toEqual([{ id: 3 }]);

            await migration.down(runner);
            expect((await runner.getTable('job_record'))?.indices).toEqual([]);
            expect(await runner.query(`${readyJobs} ORDER BY createdAt LIMIT 1`)).toEqual([{ id: 3 }]);
            expect(await runner.query('SELECT COUNT(*) AS count FROM job_record')).toEqual([{ count: 4 }]);
        } finally {
            await runner.release();
        }
    });

    it('requires online MySQL DDL and restores the session timeout after a lock failure', async () => {
        const lockError = new Error('metadata lock wait timeout');
        const query = vi
            .fn()
            .mockResolvedValueOnce([{ lockWaitTimeout: '31536000' }])
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(lockError)
            .mockResolvedValueOnce(undefined);
        const runner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(new Table({ name: 'job_record' })),
            query,
        } as unknown as QueryRunner;

        await expect(new AddJobRecordQueueIndex1794499800000().up(runner)).rejects.toThrow(lockError);
        expect(query.mock.calls).toEqual([
            ['SELECT @@SESSION.lock_wait_timeout AS lockWaitTimeout'],
            ['SET SESSION lock_wait_timeout = ?', [5]],
            [
                `ALTER TABLE \`job_record\` ADD INDEX \`${indexName}\` (\`queueName\`, \`state\`, \`createdAt\`), ALGORITHM=INPLACE, LOCK=NONE`,
            ],
            ['SET SESSION lock_wait_timeout = ?', [31536000]],
        ]);
    });
});
