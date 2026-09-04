import { DataSource, Table, TableColumn } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddStoreDomainAutomation1788526800000 } from './1788526800000-add-store-domain-automation';

describe('AddStoreDomainAutomation1788526800000 migration', () => {
    it('adds and removes the Cloudflare provisioning state columns', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'store_domain',
                    columns: [
                        new TableColumn({
                            name: 'id',
                            type: 'integer',
                            isPrimary: true,
                            isGenerated: true,
                        }),
                    ],
                }),
                true,
            );

            const migration = new AddStoreDomainAutomation1788526800000();
            await migration.up(queryRunner);
            await migration.up(queryRunner);

            let table = await queryRunner.getTable('store_domain');
            expect(table?.findColumnByName('provisioningMode')?.default).toContain('MANUAL');
            expect(table?.findColumnByName('dnsManaged')).toBeDefined();
            expect(table?.findColumnByName('providerExternalId')?.isNullable).toBe(true);
            expect(table?.findColumnByName('providerHostnameStatus')?.isNullable).toBe(true);
            expect(table?.findColumnByName('providerSslStatus')?.isNullable).toBe(true);
            expect(table?.findColumnByName('lastProvisionedAt')?.isNullable).toBe(true);

            await migration.down(queryRunner);
            table = await queryRunner.getTable('store_domain');
            expect(table?.findColumnByName('provisioningMode')).toBeUndefined();
            expect(table?.findColumnByName('dnsManaged')).toBeUndefined();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
