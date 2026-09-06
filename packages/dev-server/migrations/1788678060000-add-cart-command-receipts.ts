import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddCartCommandReceipts1788678060000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const type = queryRunner.connection.options.type;
        const idType = ['postgres', 'sqlite', 'better-sqlite3', 'sqljs'].includes(type) ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        await queryRunner.createTable(
            new Table({
                name: 'storefront_cart_command_receipt',
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
                    { name: 'commandId', type: 'varchar', length: '80' },
                    { name: 'digest', type: 'varchar', length: '64', isNullable: true },
                    { name: 'status', type: 'varchar', length: '16' },
                    { name: 'appliedRevision', type: 'int' },
                    { name: 'errorCode', type: 'varchar', length: '100', isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_cart_command_identity',
                        columnNames: ['cartId', 'commandId'],
                        isUnique: true,
                    },
                ],
                foreignKeys: [
                    {
                        columnNames: ['cartId'],
                        referencedTableName: 'storefront_cart',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    },
                ],
            }),
            true,
        );
    }

    down(): Promise<void> {
        // A code rollback must preserve acknowledgement fences, including cancelled/unknown commands.
        return Promise.reject(new Error('Retain cart command receipts when rolling back application code.'));
    }
}
