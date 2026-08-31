import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCommerceModeAndManualDelivery1787914800000 } from './1787914800000-add-commerce-mode-and-manual-delivery';

describe('commerce mode and manual delivery migration', () => {
    it('is idempotent, leaves operational data untouched and rolls its schema back', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await createLegacyTables(queryRunner);
            await seedLegacyData(queryRunner);
            const migration = new AddCommerceModeAndManualDelivery1787914800000();

            await migration.up(queryRunner);
            await migration.up(queryRunner);

            await expect(queryRunner.hasTable('customer_delivery_email')).resolves.toBe(true);
            await expect(queryRunner.hasTable('manual_digital_delivery')).resolves.toBe(true);
            await expect(queryRunner.hasTable('manual_digital_delivery_event')).resolves.toBe(true);
            expect(
                (await queryRunner.getTable('manual_digital_delivery'))?.findColumnByName(
                    'attachmentAssetIdsJson',
                )?.default,
            ).toBeUndefined();
            expect(
                (await queryRunner.getTable('channel'))?.findColumnByName('customFieldsCommercemode'),
            ).toBeTruthy();
            expect(
                (await queryRunner.getTable('auto_card_pool_item'))?.findColumnByName('encryptedRawPayload'),
            ).toBeTruthy();

            const [channel] = await queryRunner.query(
                'SELECT "customFieldsCommercemode" AS mode FROM "channel" WHERE "id" = 1',
            );
            expect(channel.mode).toBe('DIGITAL_ONLY');
            const variants = await queryRunner.query(
                'SELECT "id", "customFieldsDigitaldeliverymode" AS mode, ' +
                    '"customFieldsDigitalstockpolicy" AS policy, "trackInventory" AS inventory ' +
                    'FROM "product_variant" ORDER BY "id"',
            );
            expect(variants).toEqual([
                { id: 1, mode: 'manual_service', policy: 'limited', inventory: 'TRUE' },
                { id: 2, mode: 'file_download', policy: 'limited', inventory: 'TRUE' },
                { id: 3, mode: null, policy: 'limited', inventory: 'FALSE' },
            ]);
            const [packaging] = await queryRunner.query(
                'SELECT "enabled" FROM "product_packaging_rule" WHERE "id" = 1',
            );
            expect(Number(packaging.enabled)).toBe(1);

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('manual_digital_delivery_event')).resolves.toBe(false);
            await expect(queryRunner.hasTable('manual_digital_delivery')).resolves.toBe(false);
            await expect(queryRunner.hasTable('customer_delivery_email')).resolves.toBe(false);
            expect(
                (await queryRunner.getTable('channel'))?.findColumnByName('customFieldsCommercemode'),
            ).toBeFalsy();
            expect(
                (await queryRunner.getTable('auto_card_pool_item'))?.findColumnByName('encryptedRawPayload'),
            ).toBeFalsy();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});

async function createLegacyTables(queryRunner: ReturnType<DataSource['createQueryRunner']>) {
    await queryRunner.createTable(
        new Table({
            name: 'channel',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }),
    );
    await queryRunner.createTable(
        new Table({
            name: 'product',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'deletedAt', type: 'datetime', isNullable: true },
            ],
        }),
    );
    await queryRunner.createTable(
        new Table({
            name: 'product_variant',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'deletedAt', type: 'datetime', isNullable: true },
                { name: 'trackInventory', type: 'varchar', length: '16', default: "'INHERIT'" },
                { name: 'customFieldsFulfillmenttype', type: 'varchar', length: '255', isNullable: true },
                { name: 'customFieldsDigitaldeliverymode', type: 'varchar', length: '255', isNullable: true },
            ],
        }),
    );
    await queryRunner.createTable(
        new Table({
            name: 'auto_card_config',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'productVariantId', type: 'integer' },
                { name: 'enabled', type: 'boolean', default: false },
            ],
        }),
    );
    await queryRunner.createTable(
        new Table({
            name: 'auto_card_pool_item',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }),
    );
    for (const name of ['order', 'order_line', 'customer']) {
        await queryRunner.createTable(
            new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
        );
    }
    await queryRunner.createTable(
        new Table({
            name: 'product_packaging_rule',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'enabled', type: 'boolean', default: true },
            ],
        }),
    );
}

async function seedLegacyData(queryRunner: ReturnType<DataSource['createQueryRunner']>) {
    await queryRunner.query('INSERT INTO "channel" ("id") VALUES (1)');
    await queryRunner.query('INSERT INTO "product" ("id", "deletedAt") VALUES (1, NULL)');
    await queryRunner.query(
        'INSERT INTO "product_variant" ' +
            '("id", "deletedAt", "trackInventory", "customFieldsDigitaldeliverymode") VALUES ' +
            `(1, NULL, 'TRUE', 'manual_service'), (2, NULL, 'TRUE', 'file_download'), ` +
            `(3, NULL, 'FALSE', NULL)`,
    );
    await queryRunner.query(
        'INSERT INTO "auto_card_config" ("id", "productVariantId", "enabled") VALUES (1, 1, 1)',
    );
    await queryRunner.query('INSERT INTO "product_packaging_rule" ("id", "enabled") VALUES (1, 1)');
}
