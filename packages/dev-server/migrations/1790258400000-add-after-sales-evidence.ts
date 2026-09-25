import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddAfterSalesEvidence1790258400000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('after_sales_evidence')) return;
        const type = runner.connection.options.type;
        const mysql = type === 'mysql' || type === 'mariadb';
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        const idType = sqlite || type === 'postgres' ? 'integer' : 'int';
        const dateType = type === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const date = (name: string, nullable = true): TableColumnOptions => ({
            name,
            type: dateType,
            isNullable: nullable,
            ...(mysql ? { precision: 6 } : {}),
            ...(!nullable
                ? {
                      default: mysql
                          ? 'CURRENT_TIMESTAMP(6)'
                          : sqlite
                            ? "datetime('now')"
                            : 'CURRENT_TIMESTAMP',
                  }
                : {}),
            ...(mysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        await runner.createTable(
            new Table({
                name: 'after_sales_evidence',
                columns: [
                    {
                        name: 'id',
                        type: idType,
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    date('createdAt', false),
                    date('updatedAt', false),
                    { name: 'channelId', type: idType },
                    { name: 'customerId', type: idType },
                    { name: 'orderId', type: idType },
                    { name: 'requestId', type: idType, isNullable: true },
                    { name: 'storageKey', type: 'varchar', length: '255' },
                    { name: 'sha256', type: 'varchar', length: '64' },
                    { name: 'mimeType', type: 'varchar', length: '32' },
                    { name: 'byteSize', type: 'int' },
                    date('readyAt'),
                    date('deletedAt'),
                    date('storageDeletedAt'),
                ],
                indices: [
                    {
                        name: 'IDX_after_sales_evidence_owner',
                        columnNames: ['channelId', 'customerId', 'orderId'],
                    },
                    { name: 'IDX_after_sales_evidence_request', columnNames: ['requestId'] },
                    {
                        name: 'IDX_after_sales_evidence_cleanup',
                        columnNames: ['deletedAt', 'storageDeletedAt', 'createdAt'],
                    },
                    { name: 'UQ_after_sales_evidence_key', columnNames: ['storageKey'], isUnique: true },
                ],
                foreignKeys: [
                    ['channel', 'channel'],
                    ['customer', 'customer'],
                    ['order', 'order'],
                    ['request', 'after_sales_request'],
                ].map(([field, table]) => ({
                    name: `FK_after_sales_evidence_${field}`,
                    columnNames: [`${field}Id`],
                    referencedTableName: table,
                    referencedColumnNames: ['id'],
                    onDelete: 'RESTRICT',
                })),
            }),
            true,
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('after_sales_evidence'))
            await runner.dropTable('after_sales_evidence', true);
    }
}
