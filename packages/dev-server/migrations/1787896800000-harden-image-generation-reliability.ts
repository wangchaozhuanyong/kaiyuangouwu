import {
    MigrationInterface,
    QueryRunner,
    Table,
    TableColumn,
    TableColumnOptions,
    TableForeignKey,
    TableIndex,
} from 'typeorm';

export class HardenImageGenerationReliability1787896800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const isMysql = ['mysql', 'mariadb'].includes(databaseType);
        const isSqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || isSqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = isMysql ? 'CURRENT_TIMESTAMP(6)' : isSqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';

        await this.addColumns(queryRunner, 'image_generation_dispatch', [
            { name: 'queueTaskId', type: 'varchar', length: '120', isNullable: true },
            { name: 'processingStage', type: 'varchar', length: '32', isNullable: true },
            { name: 'heartbeatAt', type: dateType, isNullable: true },
            { name: 'stagedAssetId', type: idType, isNullable: true },
        ]);
        await this.addColumns(queryRunner, 'image_generation_output', [
            { name: 'failureCode', type: 'varchar', length: '48', isNullable: true },
        ]);
        await this.addColumns(queryRunner, 'image_generation_cost_event', [
            { name: 'failureCode', type: 'varchar', length: '48', isNullable: true },
            { name: 'providerStage', type: 'varchar', length: '32', isNullable: true },
        ]);

        const dispatch = await queryRunner.getTable('image_generation_dispatch');
        if (
            dispatch?.findColumnByName('stagedAssetId') &&
            !dispatch.foreignKeys.some(key => key.name === 'FK_image_dispatch_staged_asset')
        ) {
            await queryRunner.createForeignKey(
                dispatch,
                new TableForeignKey({
                    name: 'FK_image_dispatch_staged_asset',
                    columnNames: ['stagedAssetId'],
                    referencedTableName: 'image_private_asset',
                    referencedColumnNames: ['id'],
                    onDelete: 'SET NULL',
                }),
            );
        }

        if (!(await queryRunner.hasTable('image_generation_runtime_status'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'image_generation_runtime_status',
                    columns: [
                        {
                            name: 'createdAt',
                            type: dateType,
                            ...(isMysql ? { precision: 6 } : {}),
                            default: now,
                        },
                        {
                            name: 'updatedAt',
                            type: dateType,
                            ...(isMysql ? { precision: 6, onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
                            default: now,
                        },
                        {
                            name: 'id',
                            type: idType,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: 'increment',
                        },
                        { name: 'queueName', type: 'varchar', length: '64' },
                        { name: 'workerId', type: 'varchar', length: '96', isNullable: true },
                        { name: 'status', type: 'varchar', length: '24', isNullable: true },
                        { name: 'heartbeatAt', type: dateType, isNullable: true },
                        { name: 'lastReconcileAt', type: dateType, isNullable: true },
                        { name: 'activeJobs', type: 'int', isNullable: true },
                        { name: 'lastError', type: 'varchar', length: '500', isNullable: true },
                    ],
                }),
            );
        }
        const runtime = await queryRunner.getTable('image_generation_runtime_status');
        if (runtime && !runtime.indices.some(index => index.name === 'IDX_image_generation_runtime_queue')) {
            await queryRunner.createIndex(
                runtime,
                new TableIndex({
                    name: 'IDX_image_generation_runtime_queue',
                    columnNames: ['queueName'],
                    isUnique: true,
                }),
            );
        }
    }

    public async down(): Promise<void> {
        // Forward-only reliability migration: retaining nullable audit fields is safe for older code.
    }

    private async addColumns(
        queryRunner: QueryRunner,
        tableName: string,
        options: TableColumnOptions[],
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table) return;
        for (const option of options) {
            if (!table.findColumnByName(option.name)) {
                await queryRunner.addColumn(tableName, new TableColumn(option));
            }
        }
    }
}
