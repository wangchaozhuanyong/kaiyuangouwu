import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

const DISPATCH_RELATION_INDEX = 'REL_0be31615787ef5ff5fcb63f89e';

export class AlignHardenedImageGenerationSchema1787821200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        for (const columnName of ['providerScopeSnapshot', 'providerCredentialFingerprint']) {
            await this.removeColumnDefault(queryRunner, 'image_generation_job', columnName);
        }
        await this.alignDispatchRelationIndex(queryRunner);
    }

    public async down(): Promise<void> {
        // This data-preserving migration aligns MySQL metadata with the entity definitions.
    }

    private async removeColumnDefault(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
    ): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        const column = table?.findColumnByName(columnName);
        if (!table || !column || column.default == null) return;

        const aligned = column.clone();
        aligned.default = undefined;
        await queryRunner.changeColumn(table, column, aligned);
    }

    private async alignDispatchRelationIndex(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('image_generation_dispatch');
        if (!table) return;

        const expected = table.indices.find(index => index.name === DISPATCH_RELATION_INDEX);
        if (expected?.isUnique && this.isOutputIndex(expected)) return;

        const duplicateRows = (await queryRunner.query(
            'SELECT `outputId`, COUNT(*) AS `duplicateCount` FROM `image_generation_dispatch` GROUP BY `outputId` HAVING COUNT(*) > 1 LIMIT 1',
        )) as unknown[];
        if (duplicateRows.length > 0) {
            throw new Error('Cannot align image_generation_dispatch.outputId: duplicate values exist');
        }

        if (expected) await queryRunner.dropIndex(table, expected);
        await queryRunner.createIndex(
            table,
            new TableIndex({
                name: DISPATCH_RELATION_INDEX,
                columnNames: ['outputId'],
                isUnique: true,
            }),
        );
    }

    private isOutputIndex(index: TableIndex): boolean {
        return index.columnNames.length === 1 && index.columnNames[0] === 'outputId';
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
