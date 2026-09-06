import { createRequire } from 'node:module';
import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddUsdtTrc20Payments1787781600000 } from './1787781600000-add-usdt-trc20-payments';
import { AddUsdtActiveAmountKey1788703200000 } from './1788703200000-add-usdt-active-amount-key';
import { ReleaseUsdtHistoricalAmountKeys1788706800000 } from './1788706800000-release-usdt-historical-amount-keys';

describe('USDT active amount migrations', () => {
    it('preserves records and unique claims, supports safe rollback, and rejects rollback after reuse', async () => {
        const driver = process.env.USDT_TEST_DB ?? 'sqljs';
        if (!['sqljs', 'mysql', 'postgres'].includes(driver)) throw new Error('Unsupported isolated DB');
        const db = new DataSource({
            ...(driver === 'sqljs'
                ? { type: 'sqljs' as const }
                : {
                      type: driver as 'mysql' | 'postgres',
                      host: '127.0.0.1',
                      port: Number(process.env.USDT_TEST_PORT),
                      username: driver === 'mysql' ? 'root' : 'postgres',
                      password: '',
                      database: 'vendure_logic_repair_migrations',
                  }),
            entities: [],
            synchronize: false,
        });
        await db.initialize();
        await db.dropDatabase();
        const escape = db.driver.escape.bind(db.driver);
        const runner = db.createQueryRunner();
        const localRequire = createRequire(import.meta.url);
        const guard = localRequire('../../../deploy/usdt-migration-guard.cjs');
        const guardDb = {
            query: async (sql: string, values: unknown[]) => [
                await runner.query(localRequire('mysql2').format(sql, values)),
            ],
        };
        try {
            for (const name of ['channel', 'order', 'payment', 'storefront_usdt_checkout_quote']) {
                await runner.createTable(
                    new Table({
                        name,
                        columns: [
                            { name: 'id', type: driver === 'mysql' ? 'int' : 'integer', isPrimary: true },
                        ],
                    }),
                );
                await runner.manager
                    .createQueryBuilder()
                    .insert()
                    .into(name)
                    .values([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
                    .execute();
            }
            await new AddUsdtTrc20Payments1787781600000().up(runner);
            const row = {
                channelId: 1,
                orderId: 1,
                quoteId: 1,
                network: 'TRC20',
                tokenContractAddress: 'test-token',
                receivingAddress: 'test-address',
                receivingAddressFingerprint: 'test-fingerprint',
                matchKey: 'test-key',
                baseUsdtAmount: '1.000000',
                expectedUsdtAmount: '1.000001',
                status: 'EXPIRED',
                expiresAt: new Date('2026-08-01T00:00:00Z'),
            };
            await runner.manager
                .createQueryBuilder()
                .insert()
                .into('storefront_usdt_payment_intent')
                .values(row)
                .execute();
            const expand = new AddUsdtActiveAmountKey1788703200000();
            const release = new ReleaseUsdtHistoricalAmountKeys1788706800000();
            await expect(release.up(runner)).rejects.toThrow('unique active amount index');
            const beforeExpand = driver === 'mysql' ? await guard.historySnapshot(guardDb) : null;
            await expand.up(runner);
            if (beforeExpand) expect(await guard.historySnapshot(guardDb)).toEqual(beforeExpand);
            await expand.up(runner);
            let records = await runner.manager
                .createQueryBuilder()
                .select('*')
                .from('storefront_usdt_payment_intent', 'intent')
                .getRawMany();
            expect(records).toHaveLength(1);
            expect(records[0]).toMatchObject({
                matchKey: 'test-key',
                activeMatchKey: 'test-key',
                status: 'EXPIRED',
            });
            await runner.manager
                .createQueryBuilder()
                .insert()
                .into('storefront_usdt_payment_intent')
                .values({ ...row, quoteId: 4, matchKey: 'legacy-between-phases', status: 'PENDING' })
                .execute();
            const beforeContract = driver === 'mysql' ? await guard.historySnapshot(guardDb) : null;
            await release.up(runner);
            if (beforeContract) {
                expect(await guard.historySnapshot(guardDb)).toEqual(beforeContract);
                const schema = await guard.schemaState(guardDb);
                expect(schema).toEqual({
                    activeColumn: true,
                    activeUnique: true,
                    historyUnique: false,
                    historyIndexed: true,
                    quoteUnique: true,
                    transactionUnique: true,
                });
                expect(() => guard.assertCompatible(schema, false)).toThrow('legacy API');
                guard.assertCompatible(schema, true);
            }
            const legacy = await runner.manager
                .createQueryBuilder()
                .select('*')
                .from('storefront_usdt_payment_intent', 'intent')
                .where(`${escape('quoteId')} = 4`)
                .getRawOne();
            expect(legacy.activeMatchKey).toBe('legacy-between-phases');
            await release.up(runner);
            await expect(expand.down(runner)).rejects.toThrow('historical unique index');
            await release.down(runner);
            await expand.down(runner);
            expect(await runner.hasColumn('storefront_usdt_payment_intent', 'activeMatchKey')).toBe(false);
            await expand.up(runner);
            await release.up(runner);
            const insert = (values: object) =>
                runner.manager
                    .createQueryBuilder()
                    .insert()
                    .into('storefront_usdt_payment_intent')
                    .values(values)
                    .execute();
            await expect(insert({ ...row, quoteId: 2, activeMatchKey: 'test-key' })).rejects.toThrow();
            await runner.manager
                .createQueryBuilder()
                .update('storefront_usdt_payment_intent')
                .set({ activeMatchKey: null })
                .where(`${escape('quoteId')} = :id`, { id: 1 })
                .execute();
            await insert({
                ...row,
                quoteId: 2,
                status: 'PENDING',
                activeMatchKey: 'test-key',
                transactionId: 'a'.repeat(64),
            });
            await expect(
                insert({ ...row, quoteId: 3, activeMatchKey: null, transactionId: 'a'.repeat(64) }),
            ).rejects.toThrow();
            await expect(insert({ ...row, quoteId: 2, activeMatchKey: null })).rejects.toThrow();
            await expect(release.down(runner)).rejects.toThrow('amounts have been reused');
            // Re-running expansion after reuse must not reactivate the old historical reservation.
            await expand.up(runner);
            records = await runner.manager
                .createQueryBuilder()
                .select('*')
                .from('storefront_usdt_payment_intent', 'intent')
                .orderBy(escape('quoteId'), 'ASC')
                .getRawMany();
            expect(records).toHaveLength(3);
            expect(records[0]).toMatchObject({ activeMatchKey: null, status: 'EXPIRED' });
            expect(records[1]).toMatchObject({ activeMatchKey: 'test-key', transactionId: 'a'.repeat(64) });
            expect(records[2]).toMatchObject({ activeMatchKey: 'legacy-between-phases', status: 'PENDING' });
        } finally {
            await runner.release();
            await db.destroy();
        }
    });
});
