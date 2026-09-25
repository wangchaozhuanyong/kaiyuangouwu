import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCustomerServiceFeedback1790310000000 } from './1790310000000-add-customer-service-feedback';
import { AddCustomerProductActivity1790310060000 } from './1790310060000-add-customer-product-activity';

describe('customer account data migrations on MySQL', () => {
    it.runIf(process.env.DB === 'mysql')(
        'creates both tables twice, enforces channel scope and cascades customer deletion',
        async () => {
            const password = process.env.E2E_MYSQL_PASSWORD;
            if (!password) throw new Error('E2E_MYSQL_PASSWORD is required for the disposable MySQL fixture');
            const databaseName = `customer_account_migration_${randomUUID().replaceAll('-', '')}`;
            const connectionOptions = {
                type: 'mysql' as const,
                host: '127.0.0.1',
                port: Number(process.env.E2E_MYSQL_PORT),
                username: process.env.E2E_MYSQL_USER || 'root',
                password,
                entities: [],
                synchronize: false,
            };
            if (!Number.isInteger(connectionOptions.port) || connectionOptions.port <= 0) {
                throw new Error('E2E_MYSQL_PORT must point to a disposable local MySQL server');
            }
            const admin = await new DataSource({ ...connectionOptions, database: 'mysql' }).initialize();
            let source: DataSource | undefined;
            let runner: QueryRunner | undefined;
            try {
                await admin.query(`CREATE DATABASE \`${databaseName}\``);
                source = await new DataSource({ ...connectionOptions, database: databaseName }).initialize();
                runner = source.createQueryRunner();
                for (const name of ['channel', 'customer', 'order', 'product']) {
                    await runner.createTable(
                        new Table({
                            name,
                            columns: [{ name: 'id', type: 'int', isPrimary: true }],
                        }),
                    );
                }
                await runner.query('INSERT INTO `channel` (`id`) VALUES (1), (2)');
                await runner.query('INSERT INTO `customer` (`id`) VALUES (1)');
                await runner.query('INSERT INTO `order` (`id`) VALUES (1)');
                await runner.query('INSERT INTO `product` (`id`) VALUES (1)');

                const feedback = new AddCustomerServiceFeedback1790310000000();
                const activity = new AddCustomerProductActivity1790310060000();
                await feedback.up(runner);
                await activity.up(runner);
                await feedback.up(runner);
                await activity.up(runner);
                expect((await runner.getTable('customer_service_feedback'))?.foreignKeys).toHaveLength(3);
                expect((await runner.getTable('customer_product_activity'))?.foreignKeys).toHaveLength(3);

                await runner.query(
                    'INSERT INTO `customer_service_feedback` (`channelId`, `customerId`, `scopeKey`, `rating`, `tagsJson`) VALUES (1, 1, ?, 4, ?)',
                    ['general', '["FRIENDLY"]'],
                );
                await expect(
                    runner.query(
                        'INSERT INTO `customer_service_feedback` (`channelId`, `customerId`, `scopeKey`, `rating`, `tagsJson`) VALUES (1, 1, ?, 5, ?)',
                        ['general', '[]'],
                    ),
                ).rejects.toThrow();
                await runner.query(
                    'INSERT INTO `customer_service_feedback` (`channelId`, `customerId`, `scopeKey`, `rating`, `tagsJson`) VALUES (2, 1, ?, 5, ?)',
                    ['general', '[]'],
                );
                await runner.query(
                    'INSERT INTO `customer_product_activity` (`channelId`, `customerId`, `productId`, `kind`, `visitedAt`) VALUES (1, 1, 1, ?, CURRENT_TIMESTAMP(6))',
                    ['FAVORITE'],
                );
                await expect(
                    runner.query(
                        'INSERT INTO `customer_product_activity` (`channelId`, `customerId`, `productId`, `kind`, `visitedAt`) VALUES (1, 1, 1, ?, CURRENT_TIMESTAMP(6))',
                        ['FAVORITE'],
                    ),
                ).rejects.toThrow();
                await runner.query(
                    'INSERT INTO `customer_product_activity` (`channelId`, `customerId`, `productId`, `kind`, `visitedAt`) VALUES (2, 1, 1, ?, CURRENT_TIMESTAMP(6))',
                    ['FAVORITE'],
                );
                expect(await runner.query('SELECT `channelId` FROM `customer_service_feedback`')).toEqual([
                    { channelId: 1 },
                    { channelId: 2 },
                ]);
                expect(await runner.query('SELECT `channelId` FROM `customer_product_activity`')).toEqual([
                    { channelId: 1 },
                    { channelId: 2 },
                ]);

                await runner.query('DELETE FROM `customer` WHERE `id` = 1');
                expect(await runner.query('SELECT `id` FROM `customer_service_feedback`')).toEqual([]);
                expect(await runner.query('SELECT `id` FROM `customer_product_activity`')).toEqual([]);
                await activity.down(runner);
                await feedback.down(runner);
                expect(await runner.hasTable('customer_product_activity')).toBe(false);
                expect(await runner.hasTable('customer_service_feedback')).toBe(false);
            } finally {
                await runner?.release();
                await source?.destroy();
                await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
                await admin.destroy();
            }
        },
        120_000,
    );
});
