import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

export class AddImageProviderBillingAudit1789300800000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const db = runner.connection.options.type;
        const mysql = db === 'mysql' || db === 'mariadb';
        const dateType = db === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const idType = mysql ? 'int' : 'integer';
        const base: TableColumnOptions[] = [
            { name: 'id', type: idType, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
            ...['createdAt', 'updatedAt'].map(name => ({
                name,
                type: dateType,
                ...(mysql ? { precision: 6 } : {}),
                default: mysql ? 'CURRENT_TIMESTAMP(6)' : 'CURRENT_TIMESTAMP',
            })),
        ];
        const adjustments: TableColumnOptions[] = [
            { name: 'channelId', type: 'varchar', length: '64' },
            { name: 'targetKey', type: 'varchar', length: '64' },
            { name: 'recordType', type: 'varchar', length: '32' },
            { name: 'recordIdSnapshot', type: 'varchar', length: '64' },
            { name: 'batchId', type: 'varchar', length: '128' },
            { name: 'reviewer', type: 'varchar', length: '128' },
            { name: 'authorizationRef', type: 'varchar', length: '500' },
            { name: 'reason', type: 'varchar', length: '500' },
            { name: 'oldValueHash', type: 'varchar', length: '64' },
            { name: 'sourceHash', type: 'varchar', length: '64' },
            { name: 'entryHash', type: 'varchar', length: '64' },
            { name: 'matchingStatus', type: 'varchar', length: '32' },
            { name: 'previousAdjustmentId', type: 'varchar', length: '64', isNullable: true },
            { name: 'reviewedAt', type: dateType },
            { name: 'oldCostMicrounits', type: 'int', isNullable: true },
            { name: 'oldCurrency', type: 'varchar', length: '3', isNullable: true },
            { name: 'newCostMicrounits', type: 'int', isNullable: true },
            { name: 'newCurrency', type: 'varchar', length: '3', isNullable: true },
            { name: 'supplierBills', type: 'text' },
        ];
        await runner.createTable(
            new Table({
                name: 'image_provider_cost_adjustment',
                columns: [...base, ...adjustments],
                indices: [
                    {
                        name: 'IDX_image_cost_adjustment_batch_target',
                        columnNames: ['batchId', 'targetKey'],
                        isUnique: true,
                    },
                    { name: 'IDX_image_cost_adjustment_target', columnNames: ['targetKey', 'id'] },
                    {
                        name: 'IDX_image_cost_adjustment_channel',
                        columnNames: ['channelId', 'recordType', 'recordIdSnapshot'],
                    },
                ],
            }),
            true,
        );
        await runner.createTable(
            new Table({
                name: 'image_provider_billing_link',
                columns: [
                    ...base,
                    { name: 'billKey', type: 'varchar', length: '64' },
                    { name: 'targetKey', type: 'varchar', length: '64' },
                    { name: 'supplierScope', type: 'varchar', length: '128' },
                    { name: 'billId', type: 'varchar', length: '200' },
                    { name: 'adjustmentIdSnapshot', type: 'varchar', length: '64' },
                ],
                indices: [
                    { name: 'IDX_image_billing_link_bill', columnNames: ['billKey'], isUnique: true },
                    { name: 'IDX_image_billing_link_target', columnNames: ['targetKey'] },
                ],
            }),
            true,
        );
    }
    down(): Promise<void> {
        return Promise.reject(
            new Error('费用审定记录不可自动删除；回退应用时保留审计表，金额更正须追加审定记录。'),
        );
    }
}
