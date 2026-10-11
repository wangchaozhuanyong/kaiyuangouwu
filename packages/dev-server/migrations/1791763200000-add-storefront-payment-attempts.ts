import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddStorefrontPaymentAttempts1791763200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const type = queryRunner.connection.options.type;
        const idType = ['postgres', 'sqlite', 'better-sqlite3', 'sqljs'].includes(type) ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        await queryRunner.createTable(
            new Table({
                name: 'storefront_payment_attempt',
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
                    { name: 'cartId', type: idType },
                    { name: 'channelId', type: idType },
                    { name: 'orderId', type: idType },
                    { name: 'requestId', type: 'varchar', length: '80' },
                    { name: 'kind', type: 'varchar', length: '16' },
                    { name: 'method', type: 'varchar', length: '100' },
                    { name: 'currencyCode', type: 'varchar', length: '4' },
                    { name: 'amount', type: 'int' },
                    { name: 'status', type: 'varchar', length: '16' },
                    { name: 'errorCode', type: 'varchar', length: '100', isNullable: true },
                    { name: 'activeOrderKey', type: 'varchar', length: '80', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_payment_attempt_identity',
                        columnNames: ['cartId', 'requestId'],
                        isUnique: true,
                    },
                    {
                        name: 'IDX_payment_attempt_active_order',
                        columnNames: ['activeOrderKey'],
                        isUnique: true,
                    },
                ],
            }),
            true,
        );
    }

    async down(): Promise<void> {
        // Keep acknowledgement fences during code rollback. Never delete payment audit data.
    }
}
