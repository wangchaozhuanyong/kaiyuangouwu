import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignMysqlCommerceSchema1788271200000 } from './1788271200000-align-mysql-commerce-schema';

describe('MySQL commerce schema alignment migration', () => {
    it.each(['sqlite', 'better-sqlite3', 'sqljs', 'postgres'] as const)(
        'does not alter %s databases',
        async type => {
            const query = vi.fn();
            const queryRunner = {
                connection: { options: { type } },
                query,
            } as unknown as QueryRunner;
            const migration = new AlignMysqlCommerceSchema1788271200000();

            await migration.up(queryRunner);
            await migration.down(queryRunner);

            expect(query).not.toHaveBeenCalled();
        },
    );

    it.each(['mysql', 'mariadb'] as const)('aligns %s metadata with the runtime entities', async type => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type } },
            query,
        } as unknown as QueryRunner;

        await new AlignMysqlCommerceSchema1788271200000().up(queryRunner);

        const statements = query.mock.calls.map(([statement]) => String(statement));
        expect(statements).toHaveLength(14);
        expect(statements).toContain(
            "ALTER TABLE `product` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NULL DEFAULT 'digital'",
        );
        expect(statements).toContain(
            "ALTER TABLE `product_variant` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NULL DEFAULT 'digital'",
        );
        expect(statements).toContain(
            'ALTER TABLE `customer_delivery_email` CHANGE `isDefault` `isDefault` tinyint NOT NULL DEFAULT 0',
        );
        expect(statements).toContain(
            "ALTER TABLE `image_provider_credential` CHANGE `textModelId` `textModelId` varchar(160) NOT NULL DEFAULT ''",
        );
        expect(statements.at(-1)).toBe(
            'CREATE INDEX `IDX_customer_delivery_email_default` ON `customer_delivery_email` (`channelId`, `customerId`, `isDefault`)',
        );
    });

    it('restores the prior MySQL metadata and normalizes nullable rows during rollback', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            query,
        } as unknown as QueryRunner;

        await new AlignMysqlCommerceSchema1788271200000().down(queryRunner);

        const statements = query.mock.calls.map(([statement]) => String(statement));
        expect(statements.slice(0, 7).every(statement => statement.startsWith('UPDATE '))).toBe(true);
        expect(statements).toContain(
            "ALTER TABLE `product_variant` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NULL DEFAULT 'physical'",
        );
        expect(statements).toContain(
            'ALTER TABLE `customer_delivery_email` CHANGE `isDefault` `isDefault` tinyint(1) NOT NULL DEFAULT 0',
        );
        expect(statements.at(-1)).toBe(
            'CREATE INDEX `IDX_customer_delivery_email_default` ON `customer_delivery_email` (`channelId`, `customerId`, `isDefault`)',
        );
    });
});
