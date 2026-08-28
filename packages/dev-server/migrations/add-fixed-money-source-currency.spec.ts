import { DataSource, EntitySchema, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddFixedMoneySourceCurrency1787796000000 } from './1787796000000-add-fixed-money-source-currency';

describe('fixed money source currency migration', () => {
    it('backfills coupon and referral source currencies from their channels', async () => {
        const dataSource = new DataSource({
            type: 'sqljs',
            entities: [
                new EntitySchema({
                    name: 'Promotion',
                    tableName: 'promotion',
                    columns: {
                        id: { type: Number, primary: true },
                        conditions: { type: 'simple-json' },
                        actions: { type: 'simple-json' },
                    },
                }),
                new EntitySchema({
                    name: 'ShippingMethod',
                    tableName: 'shipping_method',
                    columns: {
                        id: { type: Number, primary: true },
                        calculator: { type: 'simple-json' },
                    },
                }),
            ],
            synchronize: false,
        });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'channel',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'defaultCurrencyCode', type: 'varchar', length: '3' },
                    ],
                }),
            );
            for (const tableName of ['customer_coupon', 'referral_program_config']) {
                await queryRunner.createTable(
                    new Table({
                        name: tableName,
                        columns: [
                            { name: 'id', type: 'integer', isPrimary: true },
                            { name: 'channelId', type: 'integer' },
                        ],
                    }),
                );
            }
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
                    name: 'promotion_channels_channel',
                    columns: [
                        { name: 'promotionId', type: 'integer' },
                        { name: 'channelId', type: 'integer' },
                    ],
                }),
            );
            await queryRunner.createTable(
                new Table({
                    name: 'store_coupon_campaign_config',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'promotionId', type: 'integer' },
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
            await queryRunner.createTable(
                new Table({
                    name: 'shipping_method_channels_channel',
                    columns: [
                        { name: 'shippingMethodId', type: 'integer' },
                        { name: 'channelId', type: 'integer' },
                    ],
                }),
            );
            await queryRunner.query(`INSERT INTO "channel" ("id", "defaultCurrencyCode") VALUES (1, 'MYR')`);
            await queryRunner.query(`INSERT INTO "customer_coupon" ("id", "channelId") VALUES (1, 1)`);
            await queryRunner.query(
                `INSERT INTO "referral_program_config" ("id", "channelId") VALUES (1, 1)`,
            );
            const conditions = JSON.stringify([
                { code: 'minimum_order_amount', args: [{ name: 'amount', value: '10000' }] },
            ]);
            const actions = JSON.stringify([
                { code: 'order_fixed_discount', args: [{ name: 'discount', value: '2000' }] },
            ]);
            await queryRunner.query(
                `INSERT INTO "promotion" ("id", "conditions", "actions") VALUES (1, ?, ?)`,
                [conditions, actions],
            );
            await queryRunner.query(`INSERT INTO "promotion_channels_channel" VALUES (1, 1)`);
            await queryRunner.query(`INSERT INTO "store_coupon_campaign_config" VALUES (1, 1)`);
            const calculator = JSON.stringify({
                code: 'physical-subtotal-shipping-calculator',
                args: [{ name: 'baseRate', value: '1200' }],
            });
            await queryRunner.query(`INSERT INTO "shipping_method" ("id", "calculator") VALUES (1, ?)`, [
                calculator,
            ]);
            await queryRunner.query(`INSERT INTO "shipping_method_channels_channel" VALUES (1, 1)`);

            const migration = new AddFixedMoneySourceCurrency1787796000000();
            await migration.up(queryRunner);

            await expect(
                queryRunner.query(`SELECT "currencyCode" FROM "customer_coupon" WHERE "id" = 1`),
            ).resolves.toEqual([{ currencyCode: 'MYR' }]);
            await expect(
                queryRunner.query(`SELECT "currencyCode" FROM "referral_program_config" WHERE "id" = 1`),
            ).resolves.toEqual([{ currencyCode: 'MYR' }]);
            const [promotion] = await queryRunner.query(`SELECT "conditions", "actions" FROM "promotion"`);
            expect(JSON.parse(promotion.conditions)).toEqual([
                {
                    code: 'store_currency_minimum_order_amount',
                    args: [
                        { name: 'amount', value: '10000' },
                        { name: 'currencyCode', value: 'MYR' },
                    ],
                },
            ]);
            expect(JSON.parse(promotion.actions)[0]).toMatchObject({
                code: 'store_currency_order_fixed_discount',
                args: expect.arrayContaining([{ name: 'currencyCode', value: 'MYR' }]),
            });
            const [shipping] = await queryRunner.query(`SELECT "calculator" FROM "shipping_method"`);
            expect(JSON.parse(shipping.calculator).args).toContainEqual({
                name: 'currencyCode',
                value: 'MYR',
            });

            await migration.down(queryRunner);
            expect(
                (await queryRunner.getTable('customer_coupon'))?.findColumnByName('currencyCode'),
            ).toBeUndefined();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
