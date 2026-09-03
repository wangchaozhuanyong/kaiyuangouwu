import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddAdminTelegramNotifications1788413600000 } from './1788413600000-add-admin-telegram-notifications';

describe('admin Telegram notification migration', () => {
    it('creates and rolls back the config, audit, outbox and runtime tables', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            const migration = new AddAdminTelegramNotifications1788413600000();
            await migration.up(queryRunner);

            await expect(queryRunner.hasTable('admin_notification_config')).resolves.toBe(true);
            await expect(queryRunner.hasTable('admin_notification_config_audit')).resolves.toBe(true);
            await expect(queryRunner.hasTable('admin_notification_outbox')).resolves.toBe(true);
            await expect(queryRunner.hasTable('admin_notification_runtime')).resolves.toBe(true);

            const outbox = await queryRunner.getTable('admin_notification_outbox');
            expect(
                outbox?.indices.find(index => index.name === 'IDX_admin_notification_dedup')?.isUnique,
            ).toBe(true);
            expect(
                outbox?.indices.find(index => index.name === 'IDX_admin_notification_active_fingerprint')
                    ?.isUnique,
            ).toBe(true);
            expect(outbox?.findColumnByName('telegramMessageId')?.type).toBe('varchar');
            expect(outbox?.findColumnByName('escalatedAt')?.isNullable).toBe(true);

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('admin_notification_config')).resolves.toBe(false);
            await expect(queryRunner.hasTable('admin_notification_config_audit')).resolves.toBe(false);
            await expect(queryRunner.hasTable('admin_notification_outbox')).resolves.toBe(false);
            await expect(queryRunner.hasTable('admin_notification_runtime')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
