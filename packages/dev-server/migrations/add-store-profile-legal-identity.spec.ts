import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddStoreProfileLegalIdentity1788530400000 } from './1788530400000-add-store-profile-legal-identity';

describe('store profile legal identity migration', () => {
    it('adds and removes the four optional legal identity fields idempotently', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'store_profile',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            const migration = new AddStoreProfileLegalIdentity1788530400000();

            await migration.up(queryRunner);
            await migration.up(queryRunner);

            const table = await queryRunner.getTable('store_profile');
            expect(table?.columns.map(column => column.name)).toEqual(
                expect.arrayContaining([
                    'legalEntityName',
                    'legalRegistrationCountry',
                    'supportEmail',
                    'privacyEmail',
                ]),
            );
            expect(table?.findColumnByName('legalEntityName')?.length).toBe('200');
            expect(table?.findColumnByName('supportEmail')?.length).toBe('254');

            await migration.down(queryRunner);
            expect(await queryRunner.hasColumn('store_profile', 'legalEntityName')).toBe(false);
            expect(await queryRunner.hasColumn('store_profile', 'privacyEmail')).toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
