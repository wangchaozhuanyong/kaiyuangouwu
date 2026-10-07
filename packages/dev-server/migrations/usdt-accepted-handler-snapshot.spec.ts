import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddUsdtAcceptedHandlerSnapshot1791388800000 } from './1791388800000-add-usdt-accepted-handler-snapshot';

describe('USDT accepted handler snapshot migration', () => {
    it('applies twice and rolls back without changing legacy records on SQL.js', async () => {
        const db = await new DataSource({ type: 'sqljs', entities: [], synchronize: false }).initialize();
        const runner = db.createQueryRunner();
        try {
            await runner.createTable(
                new Table({
                    name: 'storefront_usdt_payment_intent',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'status', type: 'varchar' },
                        { name: 'transactionId', type: 'varchar', isNullable: true },
                    ],
                }),
            );
            await runner.query(
                'INSERT INTO storefront_usdt_payment_intent (id,status,transactionId) VALUES (?,?,?)',
                [1, 'PENDING', 'historical-receipt'],
            );
            const migration = new AddUsdtAcceptedHandlerSnapshot1791388800000();
            await migration.up(runner);
            await migration.up(runner);
            expect(await runner.query('SELECT * FROM storefront_usdt_payment_intent')).toEqual([
                {
                    id: 1,
                    status: 'PENDING',
                    transactionId: 'historical-receipt',
                    acceptedHandlerSnapshot: null,
                },
            ]);
            await migration.down(runner);
            await migration.down(runner);
            expect(await runner.query('SELECT * FROM storefront_usdt_payment_intent')).toEqual([
                { id: 1, status: 'PENDING', transactionId: 'historical-receipt' },
            ]);
            await migration.up(runner);
            await runner.query(
                'UPDATE storefront_usdt_payment_intent SET acceptedHandlerSnapshot=? WHERE id=1',
                [JSON.stringify({ version: 1, methodId: 'accepted-method' })],
            );
            await expect(migration.down(runner)).rejects.toThrow('Retain USDT acceptance evidence');
            expect(await runner.hasColumn('storefront_usdt_payment_intent', 'acceptedHandlerSnapshot')).toBe(
                true,
            );
            expect((await runner.query('SELECT * FROM storefront_usdt_payment_intent'))[0]).toMatchObject({
                id: 1,
                transactionId: 'historical-receipt',
            });
        } finally {
            await runner.release();
            await db.destroy();
        }
    });
});
