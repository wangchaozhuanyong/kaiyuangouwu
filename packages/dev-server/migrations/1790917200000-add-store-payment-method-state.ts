import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/** Schema only. Legacy method mapping is reviewed separately and never inferred from a name. */
export class AddStorePaymentMethodState1790917200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('store_payment_method_state')) return;
        const mysql = ['mysql', 'mariadb'].includes(runner.connection.options.type);
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(runner.connection.options.type);
        await runner.createTable(
            new Table({
                name: 'store_payment_method_state',
                columns: [
                    {
                        name: 'id',
                        type: mysql ? 'int' : 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    ...['createdAt', 'updatedAt'].map(name => ({
                        name,
                        type:
                            runner.connection.options.type === 'postgres'
                                ? 'timestamp without time zone'
                                : 'datetime',
                        ...(mysql ? { precision: 6 } : {}),
                        default: sqlite
                            ? "datetime('now')"
                            : mysql
                              ? 'CURRENT_TIMESTAMP(6)'
                              : 'CURRENT_TIMESTAMP',
                    })),
                    { name: 'channelId', type: 'int' },
                    { name: 'paymentMethodId', type: 'int' },
                    {
                        name: 'enabled',
                        type: mysql ? 'tinyint' : 'boolean',
                        default: runner.connection.options.type === 'postgres' ? false : 0,
                    },
                ],
                indices: [
                    {
                        name: 'IDX_store_payment_method_state',
                        columnNames: ['channelId', 'paymentMethodId'],
                        isUnique: true,
                    },
                ],
            }),
            true,
        );
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error('Store payment switches are retained; use a reviewed forward migration'),
        );
    }
}
