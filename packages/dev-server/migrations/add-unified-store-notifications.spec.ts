import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddAdminTelegramNotifications1788413600000 } from './1788413600000-add-admin-telegram-notifications';
import { AddCustomerServiceFeedback1790310000000 } from './1790310000000-add-customer-service-feedback';
import { AddUnifiedStoreNotifications1790899200000 } from './1790899200000-add-unified-store-notifications';
describe('additive unified notification migration', () => {
    it('preserves existing group/configuration on repeated migration and only removes its own new structures', async () => {
        const db = await new DataSource({ type: 'sqljs', entities: [], synchronize: false }).initialize();
        const runner = db.createQueryRunner();
        try {
            await new AddAdminTelegramNotifications1788413600000().up(runner);
            await db.query(
                `INSERT INTO admin_notification_config ("key",enabled,chatId,inventoryLowThreshold) VALUES ('telegram-internal',1,'test-existing-group',2)`,
            );
            await db.query('CREATE TABLE channel (id INTEGER PRIMARY KEY)');
            await db.query('CREATE TABLE customer (id INTEGER PRIMARY KEY)');
            await db.query('CREATE TABLE "order" (id INTEGER PRIMARY KEY)');
            await db.query('INSERT INTO channel VALUES (1)');
            await db.query('INSERT INTO customer VALUES (7)');
            await new AddCustomerServiceFeedback1790310000000().up(runner);
            await db.query(
                `INSERT INTO customer_service_feedback (channelId,customerId,scopeKey,rating,tagsJson,comment) VALUES (1,7,'general',5,'[]','历史评价')`,
            );
            const migration = new AddUnifiedStoreNotifications1790899200000();
            await migration.up(runner);
            await migration.up(runner);
            expect(
                (
                    await db.query(
                        'SELECT rating, comment, notificationRevision FROM customer_service_feedback',
                    )
                )[0],
            ).toEqual({ rating: 5, comment: '历史评价', notificationRevision: 0 });
            const [config] = await db.query('SELECT * FROM admin_notification_config');
            expect(config).toMatchObject({
                enabled: 1,
                chatId: 'test-existing-group',
                inventoryLowThreshold: 2,
                notifyOnlineReports: 0,
                notifySecurityEvents: 0,
            });
            for (const name of [
                'storefront_presence',
                'storefront_presence_status',
                'customer_service_review',
                'admin_notification_signal',
            ])
                expect(await runner.hasTable(name)).toBe(true);
            expect(
                (await runner.getTable('customer_service_review'))?.indices.find(
                    index => index.name === 'IDX_service_review_identity',
                )?.isUnique,
            ).toBe(true);
            expect(await runner.hasColumn('admin_notification_outbox', 'expiresAt')).toBe(true);
            await migration.down(runner);
            expect(await runner.hasTable('customer_service_review')).toBe(false);
            expect(await runner.hasColumn('admin_notification_config', 'notifyOnlineReports')).toBe(false);
            expect((await db.query('SELECT chatId FROM admin_notification_config'))[0].chatId).toBe(
                'test-existing-group',
            );
            expect(await runner.hasTable('admin_notification_outbox')).toBe(true);
        } finally {
            await runner.release();
            await db.destroy();
        }
    });
});
