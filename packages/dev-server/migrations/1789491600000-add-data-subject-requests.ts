import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddDataSubjectRequests1789491600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const existing = await runner.getTable('data_subject_request');
        if (existing) {
            const required = [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'customerId',
                'subjectKeyHash',
                'requestType',
                'status',
                'requestedAt',
                'dueAt',
                'nextAttemptAt',
                'lastAttemptAt',
                'attemptCount',
                'blockersJson',
                'lastError',
                'resultDigest',
                'resultSummaryJson',
                'completedAt',
                'cancelledAt',
            ];
            if (!required.every(name => existing.findColumnByName(name))) {
                throw new Error(
                    'Existing data_subject_request schema is incomplete; review before continuing',
                );
            }
            return;
        }
        const channel = await runner.getTable('channel');
        const customer = await runner.getTable('customer');
        const channelId = channel?.columns.find(column => column.name === 'id');
        const customerId = customer?.columns.find(column => column.name === 'id');
        if (!channelId || !customerId) {
            throw new Error('Channel and customer tables are required for data subject requests');
        }
        const type = String(runner.connection.options.type);
        const dateType = ['postgres', 'aurora-postgres'].includes(type)
            ? 'timestamp without time zone'
            : 'datetime';
        const identity = channelId.clone();
        identity.name = 'id';
        identity.isPrimary = true;
        identity.isGenerated = true;
        identity.generationStrategy = 'increment';
        const referenceId = (name: string, source: typeof channelId) => ({
            name,
            type: source.type,
            length: source.length,
            unsigned: source.unsigned,
        });
        await runner.createTable(
            new Table({
                name: 'data_subject_request',
                columns: [
                    identity,
                    { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    referenceId('channelId', channelId),
                    referenceId('customerId', customerId),
                    { name: 'subjectKeyHash', type: 'varchar', length: '64' },
                    { name: 'requestType', type: 'varchar', length: '24' },
                    { name: 'status', type: 'varchar', length: '24', default: "'PENDING'" },
                    { name: 'requestedAt', type: dateType },
                    { name: 'dueAt', type: dateType, isNullable: true },
                    { name: 'nextAttemptAt', type: dateType, isNullable: true },
                    { name: 'lastAttemptAt', type: dateType, isNullable: true },
                    { name: 'attemptCount', type: 'int', default: 0 },
                    { name: 'blockersJson', type: 'text', isNullable: true },
                    { name: 'lastError', type: 'varchar', length: '500', isNullable: true },
                    { name: 'resultDigest', type: 'varchar', length: '64', isNullable: true },
                    { name: 'resultSummaryJson', type: 'text', isNullable: true },
                    { name: 'completedAt', type: dateType, isNullable: true },
                    { name: 'cancelledAt', type: dateType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_data_subject_request_subject_created',
                        columnNames: ['subjectKeyHash', 'createdAt'],
                    },
                    {
                        name: 'IDX_data_subject_request_due',
                        columnNames: ['requestType', 'status', 'nextAttemptAt'],
                    },
                    {
                        name: 'IDX_data_subject_request_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain data-subject request audit history during rollback'));
    }
}
