import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

const intentTableName = 'storefront_usdt_payment_intent';
const actionTableName = 'store_usdt_reconciliation_action';

export class AddUsdtReconciliationActions1789498800000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const intent = await runner.getTable(intentTableName);
        if (!intent) throw new Error('USDT payment intents must exist before reconciliation actions');
        const channel = await runner.getTable('channel');
        const user = await runner.getTable('user');
        const channelId = channel?.columns.find(column => column.name === 'id');
        const userId = user?.columns.find(column => column.name === 'id');
        if (!channelId || !userId) throw new Error('Channel and user tables are required');
        const type = String(runner.connection.options.type);
        const dateType = ['postgres', 'aurora-postgres'].includes(type)
            ? 'timestamp without time zone'
            : 'datetime';
        const nullableColumns = [
            new TableColumn({ name: 'manualReviewCode', type: 'varchar', length: '64', isNullable: true }),
            new TableColumn({ name: 'resolvedAt', type: dateType, isNullable: true }),
            new TableColumn({
                name: 'resolvedByUserId',
                type: userId.type,
                length: userId.length,
                unsigned: userId.unsigned,
                isNullable: true,
            }),
            new TableColumn({
                name: 'resolutionActionId',
                type: channelId.type,
                length: channelId.length,
                unsigned: channelId.unsigned,
                isNullable: true,
            }),
        ];
        for (const column of nullableColumns) {
            if (!intent.findColumnByName(column.name)) await runner.addColumn(intentTableName, column);
        }
        await this.backfillLegacyReviewCodes(runner);

        const existing = await runner.getTable(actionTableName);
        if (existing) {
            const required = [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'intentId',
                'orderId',
                'action',
                'outcome',
                'operatorUserId',
                'reason',
                'network',
                'transactionId',
                'usdtAmountBaseUnits',
                'fromAddress',
                'toAddress',
                'blockNumber',
                'blockTimestamp',
            ];
            if (!required.every(name => existing.findColumnByName(name))) {
                throw new Error(
                    'Existing store_usdt_reconciliation_action schema is incomplete; review before continuing',
                );
            }
            return;
        }
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
                name: actionTableName,
                columns: [
                    identity,
                    { name: 'createdAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: dateType, default: 'CURRENT_TIMESTAMP' },
                    referenceId('channelId', channelId),
                    referenceId('intentId', channelId),
                    referenceId('orderId', channelId),
                    { name: 'action', type: 'varchar', length: '32' },
                    { name: 'outcome', type: 'varchar', length: '32' },
                    referenceId('operatorUserId', userId),
                    { name: 'reason', type: 'varchar', length: '500' },
                    { name: 'network', type: 'varchar', length: '16', isNullable: true },
                    { name: 'transactionId', type: 'varchar', length: '80', isNullable: true },
                    {
                        name: 'usdtAmountBaseUnits',
                        type: 'decimal',
                        precision: 30,
                        scale: 0,
                        isNullable: true,
                    },
                    { name: 'fromAddress', type: 'varchar', length: '64', isNullable: true },
                    { name: 'toAddress', type: 'varchar', length: '64', isNullable: true },
                    { name: 'blockNumber', type: 'int', isNullable: true },
                    { name: 'blockTimestamp', type: dateType, isNullable: true },
                ],
                indices: [
                    {
                        name: 'IDX_store_usdt_reconciliation_intent_created',
                        columnNames: ['intentId', 'createdAt'],
                    },
                    {
                        name: 'IDX_store_usdt_reconciliation_channel_created',
                        columnNames: ['channelId', 'createdAt'],
                    },
                    {
                        name: 'IDX_store_usdt_reconciliation_transaction',
                        columnNames: ['network', 'transactionId'],
                        isUnique: true,
                    },
                ],
            }),
        );
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain USDT reconciliation evidence during rollback'));
    }

    private async backfillLegacyReviewCodes(runner: QueryRunner): Promise<void> {
        const mappings = [
            ['multiple-receipts', '同一付款请求收到多笔转账，请人工核对'],
            ['invalidated-quote', '已确认链上到账，但原 USDT 报价在付款前已失效，请人工核对并避免重复入账'],
            ['reused-amount', '付款金额曾用于其他报价，需核实付款归属后处理'],
            ['wallet-snapshot', '订单绑定的收款钱包快照未通过完整性校验'],
            ['order-validation-exception', '已确认到账，订单校验或入账处理异常，请人工核对；请勿重复付款'],
        ] as const;
        for (const [manualReviewCode, failureReason] of mappings) {
            await runner.manager
                .createQueryBuilder()
                .update(intentTableName)
                .set({ manualReviewCode })
                .where('status = :status', { status: 'MANUAL_REVIEW' })
                .andWhere('manualReviewCode IS NULL')
                .andWhere('failureReason = :failureReason', { failureReason })
                .execute();
        }
    }
}
