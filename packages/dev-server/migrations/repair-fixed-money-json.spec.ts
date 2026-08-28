import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { RepairFixedMoneyJson1787806800000 } from './1787806800000-repair-fixed-money-json';

describe('fixed money JSON repair migration', () => {
    it('removes only the accidental extra JSON encoding layer', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'promotion',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'conditions', type: 'text' },
                        { name: 'actions', type: 'text' },
                    ],
                }),
            );
            await queryRunner.createTable(
                new Table({
                    name: 'shipping_method',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'calculator', type: 'text' },
                    ],
                }),
            );
            const conditions = [{ code: 'minimum_order_amount', args: [] }];
            const actions = [{ code: 'order_fixed_discount', args: [] }];
            const calculator = { code: 'physical-subtotal-shipping-calculator', args: [] };
            await queryRunner.query(`INSERT INTO "promotion" VALUES (1, ?, ?)`, [
                JSON.stringify(JSON.stringify(conditions)),
                JSON.stringify(JSON.stringify(actions)),
            ]);
            await queryRunner.query(`INSERT INTO "promotion" VALUES (2, ?, ?)`, [
                JSON.stringify(conditions),
                JSON.stringify(actions),
            ]);
            await queryRunner.query(`INSERT INTO "shipping_method" VALUES (1, ?)`, [
                JSON.stringify(JSON.stringify(calculator)),
            ]);

            const migration = new RepairFixedMoneyJson1787806800000();
            await migration.up(queryRunner);
            await migration.up(queryRunner);

            const promotions = await queryRunner.query(`SELECT * FROM "promotion" ORDER BY "id"`);
            expect(promotions).toEqual([
                {
                    id: 1,
                    conditions: JSON.stringify(conditions),
                    actions: JSON.stringify(actions),
                },
                {
                    id: 2,
                    conditions: JSON.stringify(conditions),
                    actions: JSON.stringify(actions),
                },
            ]);
            const [shippingMethod] = await queryRunner.query(`SELECT * FROM "shipping_method"`);
            expect(shippingMethod.calculator).toBe(JSON.stringify(calculator));
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
