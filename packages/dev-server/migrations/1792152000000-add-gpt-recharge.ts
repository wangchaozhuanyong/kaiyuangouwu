import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddGptRecharge1792152000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const driver = runner.connection.options.type;
        const timeType = driver === 'postgres' ? 'timestamp' : 'datetime';
        const integerType = ['sqljs', 'sqlite', 'better-sqlite3'].includes(driver) ? 'integer' : 'int';
        const base = () => [
            {
                name: 'id',
                type: integerType,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment' as const,
            },
            { name: 'createdAt', type: timeType, default: 'CURRENT_TIMESTAMP' },
            { name: 'updatedAt', type: timeType, default: 'CURRENT_TIMESTAMP' },
            { name: 'channelId', type: integerType },
            { name: 'revision', type: integerType, default: 0 },
        ];
        await runner.createTable(
            new Table({
                name: 'gpt_recharge_config',
                columns: [
                    ...base(),
                    { name: 'enabled', type: 'boolean', default: false },
                    { name: 'upstreamOrigin', type: 'varchar', length: '255' },
                    { name: 'encryptedServiceKey', type: 'text' },
                ],
                indices: [
                    { name: 'UQ_gpt_recharge_config_channel', columnNames: ['channelId'], isUnique: true },
                ],
            }),
            true,
        );
        await runner.createTable(
            new Table({
                name: 'gpt_recharge_receipt',
                columns: [
                    ...base(),
                    { name: 'publicId', type: 'varchar', length: '36' },
                    { name: 'codeFingerprint', type: 'varchar', length: '64' },
                    { name: 'status', type: 'varchar', length: '32', default: "'new'" },
                    { name: 'plan', type: 'varchar', length: '16', default: "'plus'" },
                    { name: 'upstreamUpdatedAt', type: timeType, isNullable: true },
                    { name: 'encryptedUpstreamTask', type: 'text', isNullable: true },
                ],
                indices: [
                    {
                        name: 'UQ_gpt_recharge_receipt_code',
                        columnNames: ['channelId', 'codeFingerprint'],
                        isUnique: true,
                    },
                    { name: 'UQ_gpt_recharge_receipt_public', columnNames: ['publicId'], isUnique: true },
                ],
            }),
            true,
        );
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Recharge receipts contain transaction evidence; destructive rollback requires a separate reviewed migration.',
            ),
        );
    }
}
