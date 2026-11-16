import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddTaxFreeAddress1794787200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const driver = runner.connection.options.type;
        const time = driver === 'postgres' ? 'timestamp' : 'datetime';
        const integer = ['sqljs', 'sqlite', 'better-sqlite3'].includes(driver) ? 'integer' : 'int';
        const base = () => [
            {
                name: 'id',
                type: integer,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment' as const,
            },
            { name: 'createdAt', type: time, default: 'CURRENT_TIMESTAMP' },
            { name: 'updatedAt', type: time, default: 'CURRENT_TIMESTAMP' },
        ];
        await runner.createTable(
            new Table({
                name: 'tax_free_address_pool',
                columns: [
                    ...base(),
                    { name: 'cursor', type: integer, default: 0 },
                    { name: 'revision', type: integer, default: 0 },
                ],
            }),
            true,
        );
        // Idempotent bootstrap; never reset the cursor or revision on migration replay.
        await runner.manager
            .createQueryBuilder()
            .insert()
            .into('tax_free_address_pool')
            .values({ id: 1, cursor: 0, revision: 0 })
            .orIgnore()
            .execute();
        await runner.createTable(
            new Table({
                name: 'tax_free_address_fingerprint',
                columns: [
                    ...base(),
                    { name: 'fingerprint', type: 'varchar', length: '64' },
                    { name: 'requestKey', type: 'varchar', length: '64', isNullable: true },
                    { name: 'browserHash', type: 'varchar', length: '64', isNullable: true },
                    { name: 'channelId', type: 'varchar', length: '64', isNullable: true },
                    { name: 'claimedAt', type: time, precision: 3, isNullable: true },
                ],
                indices: [
                    { name: 'UQ_tax_address_fingerprint', columnNames: ['fingerprint'], isUnique: true },
                    { name: 'UQ_tax_address_request', columnNames: ['requestKey'], isUnique: true },
                    { name: 'IDX_tax_address_browser_claim', columnNames: ['browserHash', 'claimedAt'] },
                ],
            }),
            true,
        );
        await runner.createTable(
            new Table({
                name: 'tax_free_address',
                columns: [
                    ...base(),
                    { name: 'fingerprint', type: 'varchar', length: '64' },
                    { name: 'country', type: 'varchar', length: '32' },
                    { name: 'line1', type: 'varchar', length: '120' },
                    { name: 'city', type: 'varchar', length: '80' },
                    { name: 'state', type: 'varchar', length: '80' },
                    { name: 'postalCode', type: 'varchar', length: '5' },
                    { name: 'status', type: 'varchar', length: '8', default: "'unused'" },
                    { name: 'usedAt', type: time, precision: 3, isNullable: true },
                ],
                indices: [
                    { name: 'UQ_tax_address_live_fingerprint', columnNames: ['fingerprint'], isUnique: true },
                    { name: 'IDX_tax_address_status_used', columnNames: ['status', 'usedAt'] },
                ],
            }),
            true,
        );
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error(
                'Permanent address fingerprints and claim receipts must survive code rollback; destructive removal requires a separately reviewed migration.',
            ),
        );
    }
}
