import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddDataRetentionRecords1789488000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const existing = await runner.getTable('data_retention_record');
        if (existing) {
            const required = [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'resourceType',
                'resourceKey',
                'subjectKeyHash',
                'policyCode',
                'reason',
                'status',
                'quarantinedAt',
                'purgeAfter',
                'nextAttemptAt',
                'legalHold',
                'legalHoldReason',
                'legalHoldChangedByUserId',
                'legalHoldChangedAt',
                'attemptCount',
                'lastAttemptAt',
                'lastError',
                'completedAt',
            ];
            if (!required.every(name => existing.findColumnByName(name))) {
                throw new Error(
                    'Existing data_retention_record schema is incomplete; review before continuing',
                );
            }
            return;
        }
        const channel = await runner.getTable('channel');
        const channelId = channel?.columns.find(column => column.name === 'id');
        if (!channelId) throw new Error('Channel table is required for data retention records');
        const type = String(runner.connection.options.type);
        const dateType = ['postgres', 'aurora-postgres'].includes(type)
            ? 'timestamp without time zone'
            : 'datetime';
        const identity = channelId.clone();
        identity.name = 'id';
        identity.isPrimary = true;
        identity.isGenerated = true;
        identity.generationStrategy = 'increment';
        const referenceId = (name: string, nullable = false) => ({
            name,
            type: channelId.type,
            length: channelId.length,
            unsigned: channelId.unsigned,
            isNullable: nullable,
        });
        await runner.createTable(
            new Table({
                name: 'data_retention_record',
                columns: [
                    identity,
                    { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    referenceId('channelId'),
                    { name: 'resourceType', type: 'varchar', length: '32' },
                    { name: 'resourceKey', type: 'varchar', length: '64' },
                    { name: 'subjectKeyHash', type: 'varchar', length: '64' },
                    { name: 'policyCode', type: 'varchar', length: '64' },
                    { name: 'reason', type: 'varchar', length: '64' },
                    { name: 'status', type: 'varchar', length: '24', default: "'PENDING'" },
                    { name: 'quarantinedAt', type: dateType },
                    { name: 'purgeAfter', type: dateType },
                    { name: 'nextAttemptAt', type: dateType, isNullable: true },
                    { name: 'legalHold', type: 'boolean', default: false },
                    { name: 'legalHoldReason', type: 'varchar', length: '500', isNullable: true },
                    referenceId('legalHoldChangedByUserId', true),
                    { name: 'legalHoldChangedAt', type: dateType, isNullable: true },
                    { name: 'attemptCount', type: 'int', default: 0 },
                    { name: 'lastAttemptAt', type: dateType, isNullable: true },
                    { name: 'lastError', type: 'varchar', length: '500', isNullable: true },
                    { name: 'completedAt', type: dateType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'UQ_data_retention_resource',
                        columnNames: ['resourceType', 'resourceKey'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_data_retention_due',
                        columnNames: ['status', 'legalHold', 'nextAttemptAt'],
                    },
                    {
                        name: 'IDX_data_retention_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain deletion audit history during application rollback'));
    }
}
