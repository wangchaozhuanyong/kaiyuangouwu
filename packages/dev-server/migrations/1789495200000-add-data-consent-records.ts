import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddDataConsentRecords1789495200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const existing = await runner.getTable('data_consent_record');
        if (existing) {
            const required = [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'customerId',
                'subjectKeyHash',
                'purpose',
                'action',
                'policyVersion',
                'policyDigest',
                'locale',
                'source',
                'ipHash',
                'userAgentHash',
                'recordedAt',
            ];
            if (!required.every(name => existing.findColumnByName(name))) {
                throw new Error(
                    'Existing data_consent_record schema is incomplete; review before continuing',
                );
            }
            return;
        }
        const channel = await runner.getTable('channel');
        const customer = await runner.getTable('customer');
        const channelId = channel?.columns.find(column => column.name === 'id');
        const customerId = customer?.columns.find(column => column.name === 'id');
        if (!channelId || !customerId) throw new Error('Channel and customer tables are required');
        const type = String(runner.connection.options.type);
        const dateType = ['postgres', 'aurora-postgres'].includes(type)
            ? 'timestamp without time zone'
            : 'datetime';
        const identity = channelId.clone();
        identity.name = 'id';
        identity.isPrimary = true;
        identity.isGenerated = true;
        identity.generationStrategy = 'increment';
        const referenceId = (name: string, source: typeof channelId, isNullable = false) => ({
            name,
            type: source.type,
            length: source.length,
            unsigned: source.unsigned,
            isNullable,
        });
        await runner.createTable(
            new Table({
                name: 'data_consent_record',
                columns: [
                    identity,
                    { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    referenceId('channelId', channelId),
                    referenceId('customerId', customerId, true),
                    { name: 'subjectKeyHash', type: 'varchar', length: '64' },
                    { name: 'purpose', type: 'varchar', length: '24' },
                    { name: 'action', type: 'varchar', length: '24' },
                    { name: 'policyVersion', type: 'varchar', length: '160' },
                    { name: 'policyDigest', type: 'varchar', length: '64' },
                    { name: 'locale', type: 'varchar', length: '16' },
                    { name: 'source', type: 'varchar', length: '32' },
                    { name: 'ipHash', type: 'varchar', length: '64', isNullable: true },
                    { name: 'userAgentHash', type: 'varchar', length: '64', isNullable: true },
                    { name: 'recordedAt', type: dateType },
                ],
                indices: [
                    {
                        name: 'IDX_data_consent_subject_created',
                        columnNames: ['subjectKeyHash', 'createdAt'],
                    },
                    {
                        name: 'IDX_data_consent_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                    {
                        name: 'IDX_data_consent_purpose_created',
                        columnNames: ['purpose', 'createdAt'],
                    },
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain consent evidence during rollback'));
    }
}
