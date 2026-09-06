import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

const tableName = 'storefront_usdt_payment_intent';
const historyIndex = 'IDX_storefront_usdt_intent_match_key';

/** Apply only after every old API/worker writer has stopped. See the USDT amount migration runbook. */
export class ReleaseUsdtHistoricalAmountKeys1788706800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (
            !table?.indices.some(
                candidate =>
                    candidate.name === 'IDX_storefront_usdt_intent_active_match_key' && candidate.isUnique,
            )
        ) {
            throw new Error('The unique active amount index must exist before releasing historical keys');
        }
        const index = table.indices.find(candidate => candidate.name === historyIndex);
        if (index?.isUnique === false) return;
        if (index?.isUnique) {
            // An old writer may have inserted rows between expansion and the coordinated stop.
            // While historical uniqueness still holds, conservatively reserve those rows as well.
            const escape = queryRunner.connection.driver.escape.bind(queryRunner.connection.driver);
            await queryRunner.manager
                .createQueryBuilder()
                .update(tableName)
                .set({ activeMatchKey: () => escape('matchKey'), updatedAt: () => escape('updatedAt') })
                .where(`${escape('activeMatchKey')} IS NULL`)
                .execute();
        }
        if (index) await queryRunner.dropIndex(tableName, index);
        await queryRunner.createIndex(
            tableName,
            new TableIndex({
                name: historyIndex,
                columnNames: ['matchKey'],
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table) return;
        const index = table.indices.find(candidate => candidate.name === historyIndex);
        if (index?.isUnique) return;
        const escape = queryRunner.connection.driver.escape.bind(queryRunner.connection.driver);
        const key = `${escape('intent')}.${escape('matchKey')}`;
        const duplicates = await queryRunner.manager
            .createQueryBuilder()
            .select(key, 'matchKey')
            .from(tableName, 'intent')
            .groupBy(key)
            .having('COUNT(*) > 1')
            .limit(1)
            .getRawMany();
        if (duplicates.length) {
            throw new Error(
                'USDT amounts have been reused; use a schema-compatible rollback without deleting payment history',
            );
        }
        if (index) await queryRunner.dropIndex(tableName, index);
        await queryRunner.createIndex(
            tableName,
            new TableIndex({
                name: historyIndex,
                columnNames: ['matchKey'],
                isUnique: true,
            }),
        );
    }
}
