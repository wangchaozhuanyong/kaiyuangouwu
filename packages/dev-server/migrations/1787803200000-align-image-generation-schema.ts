import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

const STORAGE_KEY_INDEX = 'IDX_image_private_asset_storage_key';

export class AlignImageGenerationSchema1787803200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        for (const tableName of [
            'image_generation_job',
            'image_generation_output',
            'referral_wallet_usage',
        ]) {
            await this.alignColumn(queryRunner, tableName, 'version', column => {
                column.type = 'int';
                column.isNullable = false;
                column.default = undefined;
            });
        }

        for (const tableName of ['referral_program_config', 'customer_coupon']) {
            await this.alignColumn(queryRunner, tableName, 'currencyCode', column => {
                column.type = 'varchar';
                column.length = '3';
                column.isNullable = false;
                column.default = undefined;
            });
        }

        await this.alignStorageKeyIndex(queryRunner);
    }

    public async down(): Promise<void> {
        // This data-preserving migration aligns MySQL metadata with the entity definitions.
    }

    private async alignColumn(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        align: (column: TableColumn) => void,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column) return;

        const aligned = column.clone();
        align(aligned);
        if (this.columnsMatch(column, aligned)) return;
        await queryRunner.changeColumn(table, column, aligned);
    }

    private async alignStorageKeyIndex(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('image_private_asset');
        if (!table) return;

        const expected = table.indices.find(index => index.name === STORAGE_KEY_INDEX);
        if (expected?.isUnique && this.isStorageKeyIndex(expected)) return;

        const duplicateRows = (await queryRunner.query(
            'SELECT `storageKey`, COUNT(*) AS `duplicateCount` FROM `image_private_asset` GROUP BY `storageKey` HAVING COUNT(*) > 1 LIMIT 1',
        )) as unknown[];
        if (duplicateRows.length > 0) {
            throw new Error('Cannot align image_private_asset.storageKey: duplicate values exist');
        }

        for (const index of table.indices.filter(
            candidate => candidate.isUnique && this.isStorageKeyIndex(candidate),
        )) {
            await queryRunner.dropIndex(table, index);
        }
        for (const unique of table.uniques.filter(
            candidate => candidate.columnNames.length === 1 && candidate.columnNames[0] === 'storageKey',
        )) {
            await queryRunner.dropUniqueConstraint(table, unique);
        }

        await queryRunner.createIndex(
            table,
            new TableIndex({
                name: STORAGE_KEY_INDEX,
                columnNames: ['storageKey'],
                isUnique: true,
            }),
        );
    }

    private isStorageKeyIndex(index: TableIndex): boolean {
        return index.columnNames.length === 1 && index.columnNames[0] === 'storageKey';
    }

    private columnsMatch(current: TableColumn, expected: TableColumn): boolean {
        return (
            current.type === expected.type &&
            current.length === expected.length &&
            current.isNullable === expected.isNullable &&
            this.normalizeDefault(current.default) === this.normalizeDefault(expected.default)
        );
    }

    private normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
        if (value == null) return undefined;
        return String(value)
            .replace(/^\((.*)\)$/u, '$1')
            .trim();
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
